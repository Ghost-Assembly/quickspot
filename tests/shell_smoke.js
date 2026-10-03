// Loaded only in the isolated GNOME session by scripts/check_live.py.
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import Gio from 'gi://Gio';
import QuickSpotExtension from './quickspot.js';
import { SpotifyClient } from './modules/spotify.js';
import { writeShortcuts } from './modules/shortcuts.js';

function check(condition, message) {
    if (!condition) throw new Error(message);
}

// Exercise a populated menu without contacting Spotify or the user's keyring.
SpotifyClient.prototype.playlists = async () => [
    { name: 'Test playlist', uri: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M' },
    { name: 'Discover Weekly', uri: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5N' },
];

export default class ShellSmoke extends QuickSpotExtension {
    enable() {
        this._failStartup = true;
        let failed = false;
        try {
            super.enable();
        } catch (error) {
            check(error.message === 'Test startup failure', error.message);
            failed = true;
        } finally {
            this._failStartup = false;
        }
        check(failed, 'Startup failure was not propagated.');
        check(
            !Object.hasOwn(Main.panel.statusArea, this.uuid),
            'Failed startup left a panel button attached.',
        );
        check(
            !this._settings && !this._soloist && !this._spotify,
            'Failed startup left clients or settings attached.',
        );
        console.debug('[quickspot-test] startup rollback passed');
        super.enable();
        check(
            !this._button.trackLabel.visible &&
                this._button.trackLabel.text === '' &&
                this._button.accessible_name === 'QuickSpot',
            'Startup did not show an accessible icon-only indicator.',
        );
        this._soloist.state = {
            ...this._soloist.state,
            active: true,
            connected: true,
            title: 'Test song',
            artist: 'Test artist',
            loggedIn: true,
            shuffle: false,
            enhancement: 'NONE',
        };
        this._sync();
        check(
            this._button.trackLabel.visible &&
                this._button.trackLabel.text === 'Test artist — Test song',
            'Now playing did not appear in the top bar.',
        );
        check(
            this._button.accessible_name === 'Test artist — Test song',
            'Now playing is missing an accessible label.',
        );
        check(
            this._shuffle.label.text === 'Shuffle: Off',
            'Shuffle control did not reflect disabled shuffle.',
        );
        this._soloist.state.shuffle = true;
        this._soloist.state.enhancement = 'RECOMMENDATION';
        this._sync();
        check(
            this._shuffle.label.text === 'Shuffle: Smart Shuffle' &&
                this._shuffleItems.get('smart')._ornament === PopupMenu.Ornament.NONE,
            'Smart Shuffle indicator did not follow player state.',
        );
        this._soloist.state.active = false;
        this._sync();
        check(
            !this._button.trackLabel.visible &&
                this._button.trackLabel.text === '' &&
                this._button.accessible_name === 'QuickSpot',
            'Inactive device did not restore the accessible icon-only indicator.',
        );
        check(
            this._shuffle.sensitive && this._shuffleItems.get('on').sensitive,
            'Inactive paired speaker disabled shuffle controls.',
        );
        this._soloist.state.shuffle = null;
        this._sync();
        check(
            this._shuffleItems.get('on').sensitive &&
                this._shuffleItems.get('off').sensitive,
            'Unknown shuffle state disabled actionable shuffle controls.',
        );
        const launchUri = Gio.AppInfo.launch_default_for_uri;
        let launched = false;
        try {
            Gio.AppInfo.launch_default_for_uri = () => {
                launched = true;
            };
            check(
                this._shuffleItems.get('smart').label.text === 'About Smart Shuffle…',
                'Smart Shuffle help was mislabeled as a playback action.',
            );
            this._shuffleItems.get('smart').activate(null);
            check(!launched, 'Smart Shuffle help opened an external application.');
        } finally {
            Gio.AppInfo.launch_default_for_uri = launchUri;
        }
        this._soloist.state.loggedIn = false;
        this._sync();
        check(!this._shuffle.sensitive, 'Unpaired speaker enabled shuffle.');
        writeShortcuts(this._settings, [
            {
                name: 'Weekly mix',
                uri: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5N',
            },
        ]);
        this._renderShortcuts();
        this._sync();
        check(
            this._shortcutItems.length === 1 && !this._shortcutItems[0].sensitive,
            'Unpaired speaker enabled manual playlist playback.',
        );
        this._soloist.state.loggedIn = true;
        this._sync();
        check(
            this._shortcutItems[0].sensitive,
            'Paired speaker disabled manual playlist playback.',
        );
        const command = this._soloist.command;
        let played;
        try {
            this._soloist.command = async (action, uri) => {
                played = { action, uri };
            };
            this._shortcutItems[0].activate(null);
            check(
                played?.action === 'play' &&
                    played.uri === 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5N',
                'Manual shortcut did not play the saved playlist.',
            );
        } finally {
            this._soloist.command = command;
        }
        writeShortcuts(this._settings, []);
        this._renderShortcuts();
        check(
            this._shortcutItems.length === 0,
            'Removed shortcut remained in the panel.',
        );
        console.debug('[quickspot-test] top bar metadata passed');
    }

    _sync() {
        if (this._failStartup) throw new Error('Test startup failure');
        super._sync();
    }

    async _loadPlaylists() {
        const loading = super._loadPlaylists();
        if (this._button && this._loading)
            check(
                this._playlistItems.length === 0,
                'Loading playlists retained entries from the previous library.',
            );
        await loading;
        if (!this._button) return;
        check(this._playlistItems.length === 2, 'Playlist menu did not populate.');
        console.debug('[quickspot-test] populated menu passed');
    }

    disable() {
        super.disable();
        check(
            this._playlistItems.length === 0,
            'Teardown retained destroyed playlist menu items.',
        );
        check(
            !this._menu &&
                !this._library &&
                !this._shortcuts &&
                this._shortcutItems.length === 0,
            'Teardown retained destroyed menus.',
        );
        console.debug('[quickspot-test] teardown passed');
    }
}
