// Loaded only in the isolated GNOME session by scripts/check_live.py.
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import QuickSpotExtension from './quickspot.js';
import { SpotifyClient } from './modules/spotify.js';

function check(condition, message) {
    if (!condition) throw new Error(message);
}

// Exercise a populated menu without contacting Spotify or the user's keyring.
SpotifyClient.prototype.playlists = async () => [
    { name: 'Test playlist', uri: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M' },
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
        this._soloist.state = {
            ...this._soloist.state,
            active: true,
            title: 'Test song',
            artist: 'Test artist',
        };
        this._sync();
        check(
            this._button.trackLabel.text === 'Test artist — Test song',
            'Now playing did not appear in the top bar.',
        );
        check(
            this._button.accessible_name === 'Test artist — Test song',
            'Now playing is missing an accessible label.',
        );
        this._soloist.state.active = false;
        this._sync();
        check(
            this._button.trackLabel.text === 'QuickSpot',
            'Inactive device left stale music in the top bar.',
        );
        console.debug('[quickspot-test] top bar metadata passed');
    }

    _sync() {
        if (this._failStartup) throw new Error('Test startup failure');
        super._sync();
    }

    async _loadPlaylists() {
        await super._loadPlaylists();
        if (!this._button) return;
        check(
            this._playlistItems.length === 1,
            'Playlist menu did not populate.',
        );
        console.debug('[quickspot-test] populated menu passed');
    }

    disable() {
        super.disable();
        check(
            this._playlistItems.length === 0,
            'Teardown retained destroyed playlist menu items.',
        );
        check(
            !this._menu && !this._library,
            'Teardown retained destroyed menus.',
        );
        console.debug('[quickspot-test] teardown passed');
    }
}
