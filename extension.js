// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { PlayerController } from './modules/player.js';
import { SpotifyClient } from './modules/spotify.js';
import { shuffleMode } from './modules/model.js';
import { readShortcuts } from './modules/shortcuts.js';

const QuickSpotButton = GObject.registerClass(
    class QuickSpotButton extends PanelMenu.Button {
        _init() {
            super._init(0.5, 'QuickSpot');
            const box = new St.BoxLayout({
                style_class: 'panel-status-menu-box',
            });
            box.add_child(
                new St.Icon({
                    icon_name: 'audio-x-generic-symbolic',
                    style_class: 'system-status-icon',
                }),
            );
            this.trackLabel = new St.Label({
                text: '',
                visible: false,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'quickspot-track',
            });
            this.trackLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            box.add_child(this.trackLabel);
            this.add_child(box);
        }
    },
);

export default class QuickSpotExtension extends Extension {
    enable() {
        try {
            this._enable();
        } catch (error) {
            this.disable();
            throw error;
        }
    }

    _enable() {
        this._settings = this.getSettings();
        this._button = new QuickSpotButton();
        this._player = new PlayerController(() => this._sync());
        this._soloist = this._player.soloist;
        this._serviceBusy = false;
        this._shuffleBusy = false;
        this._spotify = new SpotifyClient();
        this._playlists = [];
        this._playlistItems = [];
        this._libraryStatus = 'Connect Spotify in settings';
        this._loading = false;
        this._menu = this._button.menu;
        this._status = new PopupMenu.PopupMenuItem('Soloist is stopped', {
            reactive: false,
        });
        this._menu.addMenuItem(this._status);
        this._previous = this._action('Previous', () =>
            this._soloist.command('skip_prev'),
        );
        this._play = this._action('Play', () =>
            this._soloist.command(
                this._soloist.state.status === 'playing' ? 'pause' : 'play',
            ),
        );
        this._next = this._action('Next', () =>
            this._soloist.command('skip_next'),
        );
        this._activate = this._action('Use this device', () =>
            this._soloist.command('activate'),
        );
        this._shuffle = new PopupMenu.PopupSubMenuMenuItem('Shuffle');
        this._menu.addMenuItem(this._shuffle);
        this._shuffleItems = new Map();
        for (const [mode, label] of [
            ['off', 'Off'],
            ['on', 'On'],
            ['smart', 'About Smart Shuffle…'],
        ]) {
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => {
                if (mode === 'smart') {
                    void this._perform(() => {
                        Main.notify(
                            'QuickSpot',
                            'QuickSpot can display Smart Shuffle, but cannot enable it yet. Enable it in Spotify’s phone app with this speaker selected; QuickSpot will follow the change.',
                        );
                    });
                    return;
                }
                void this._perform(async () => {
                    if (this._shuffleBusy) return;
                    const player = this._soloist;
                    this._shuffleBusy = true;
                    this._sync();
                    try {
                        await player.setShuffle(mode === 'on');
                    } finally {
                        if (this._soloist === player) {
                            this._shuffleBusy = false;
                            this._sync();
                        }
                    }
                });
            });
            this._shuffle.menu.addMenuItem(item);
            this._shuffleItems.set(mode, item);
        }
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._shortcuts = new PopupMenu.PopupSubMenuMenuItem(
            'Playlist shortcuts',
        );
        this._menu.addMenuItem(this._shortcuts);
        this._renderShortcuts();
        this._liked = this._action('Liked Songs', async () => {
            const client = this._spotify;
            const player = this._soloist;
            const uri = await client.likedSongs();
            if (this._spotify === client && this._soloist === player)
                await player.command('play', uri);
        });
        this._library = new PopupMenu.PopupSubMenuMenuItem('Your playlists');
        this._menu.addMenuItem(this._library);
        this._action('Refresh playlists', () => this._loadPlaylists());
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._togglePlayer = this._action('Set up player…', async () => {
            if (this._serviceBusy) return;
            this._serviceBusy = true;
            const player = this._player;
            this._sync();
            try {
                await player.refresh();
                if (this._player !== player) return;
                if (!player.presentation.canToggle)
                    return this.openPreferences();
                await player.control(
                    player.presentation.running ? 'stop' : 'start',
                );
            } finally {
                if (this._player === player) {
                    this._serviceBusy = false;
                    this._sync();
                }
            }
        });
        this._action('Open Spotify in browser', () =>
            Gio.AppInfo.launch_default_for_uri(
                'https://open.spotify.com/',
                null,
            ),
        );
        this._action('QuickSpot settings', () => this.openPreferences());
        this._accountId = this._settings.connect(
            'changed::account-generation',
            () => {
                this._spotify.destroy();
                this._spotify = new SpotifyClient();
                this._loading = false;
                this._loadPlaylists();
            },
        );
        this._shortcutsId = this._settings.connect(
            'changed::playlist-shortcuts',
            () => {
                this._renderShortcuts();
                this._sync();
            },
        );
        Main.panel.addToStatusArea(this.uuid, this._button);
        this._player.start();
        this._sync();
        this._loadPlaylists();
        console.debug('[quickspot] enabled');
    }

    _action(label, callback) {
        const item = new PopupMenu.PopupMenuItem(label);
        item.connect('activate', () => {
            // Every UI action catches failures before they reach GNOME Shell.
            void this._perform(callback);
        });
        this._menu.addMenuItem(item);
        return item;
    }

    async _perform(callback) {
        const button = this._button;
        try {
            await callback();
        } catch (error) {
            if (button && this._button === button)
                Main.notify('QuickSpot', error.message);
        }
    }

    async _loadPlaylists() {
        if (this._loading || !this._button) return;
        this._loading = true;
        const client = this._spotify;
        this._playlists = [];
        this._libraryStatus = 'Loading playlists…';
        this._renderLibrary();
        try {
            const playlists = await client.playlists();
            if (this._spotify !== client) return;
            this._playlists = playlists;
            this._libraryStatus = playlists.length ? '' : 'No saved playlists';
        } catch (error) {
            if (this._spotify !== client) return;
            this._libraryStatus = error.message;
            this._playlists = [];
        } finally {
            if (this._spotify === client) {
                this._loading = false;
                this._renderLibrary();
                this._sync();
            }
        }
    }

    _renderLibrary() {
        if (!this._button) return;
        this._library.menu.removeAll();
        this._playlistItems = [];
        if (this._libraryStatus)
            this._library.menu.addMenuItem(
                new PopupMenu.PopupMenuItem(this._libraryStatus, {
                    reactive: false,
                }),
            );
        for (const playlist of this._playlists) {
            const item = this._playlistItem(playlist);
            this._library.menu.addMenuItem(item);
            this._playlistItems.push(item);
        }
    }

    _playlistItem(playlist) {
        const item = new PopupMenu.PopupMenuItem(playlist.name);
        item.setSensitive(this._soloist.state.loggedIn);
        item.connect('activate', () => {
            void this._perform(() =>
                this._soloist.command('play', playlist.uri),
            );
        });
        return item;
    }

    _renderShortcuts() {
        this._shortcuts.menu.removeAll();
        this._shortcutItems = [];
        for (const playlist of readShortcuts(this._settings)) {
            const item = this._playlistItem(playlist);
            this._shortcuts.menu.addMenuItem(item);
            this._shortcutItems.push(item);
        }
        if (this._shortcutItems.length)
            this._shortcuts.menu.addMenuItem(
                new PopupMenu.PopupSeparatorMenuItem(),
            );
        const add = new PopupMenu.PopupMenuItem('Add playlist shortcut…');
        add.connect(
            'activate',
            () => void this._perform(() => this.openPreferences()),
        );
        this._shortcuts.menu.addMenuItem(add);
    }

    _sync() {
        if (!this._button) return;
        const state = this._soloist.state;
        const view = this._player.presentation;
        this._status.label.text = state.error || view.title;
        this._button.trackLabel.text =
            state.active && state.title
                ? [state.artist, state.title].filter(Boolean).join(' — ')
                : '';
        this._button.trackLabel.visible = Boolean(this._button.trackLabel.text);
        this._button.accessible_name =
            this._button.trackLabel.text || 'QuickSpot';
        this._play.label.text = state.status === 'playing' ? 'Pause' : 'Play';
        const mode = shuffleMode(state);
        const shuffleLabels = new Map([
            ['unknown', 'Unknown'],
            ['off', 'Off'],
            ['on', 'On'],
            ['smart', 'Smart Shuffle'],
        ]);
        this._shuffle.label.text = `Shuffle: ${shuffleLabels.get(mode)}`;
        this._shuffle.setSensitive(state.connected && state.loggedIn);
        for (const [value, item] of this._shuffleItems) {
            item.setOrnament(
                value === mode && value !== 'smart'
                    ? PopupMenu.Ornament.CHECK
                    : PopupMenu.Ornament.NONE,
            );
            item.setSensitive(!this._shuffleBusy);
        }
        for (const item of [
            this._previous,
            this._play,
            this._next,
            this._activate,
        ])
            item.setSensitive(state.loggedIn);
        for (const item of this._shortcutItems ?? [])
            item.setSensitive(state.loggedIn);
        this._liked.setSensitive(state.loggedIn);
        this._togglePlayer.label.text = view.canToggle
            ? `${view.toggleLabel} player`
            : 'Set up player…';
        this._togglePlayer.setSensitive(
            !this._serviceBusy && !this._player.state.checking,
        );
        for (const item of this._playlistItems ?? [])
            item.setSensitive(state.loggedIn);
    }

    disable() {
        if (this._accountId) this._settings?.disconnect(this._accountId);
        if (this._shortcutsId) this._settings?.disconnect(this._shortcutsId);
        this._accountId = 0;
        this._shortcutsId = 0;
        this._player?.destroy();
        this._spotify?.destroy();
        this._button?.destroy();
        this._settings = null;
        this._button = null;
        this._soloist = null;
        this._player = null;
        this._spotify = null;
        this._playlists = [];
        this._playlistItems = [];
        this._menu = null;
        this._library = null;
        this._status = null;
        this._previous = null;
        this._play = null;
        this._next = null;
        this._activate = null;
        this._shuffle = null;
        this._shuffleItems = null;
        this._shuffleBusy = false;
        this._shortcuts = null;
        this._shortcutItems = [];
        this._liked = null;
        this._togglePlayer = null;
        this._loading = false;
        console.debug('[quickspot] disabled');
    }
}
