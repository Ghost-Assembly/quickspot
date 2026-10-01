// SPDX-License-Identifier: GPL-3.0-or-later
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { deviceName, playlistShortcut, soloistKey } from './modules/model.js';
import { lookupSecret, storeSecret, clearSecret } from './modules/secrets.js';
import {
    SpotifyClient,
    SpotifyLogin,
    REDIRECT_URI,
} from './modules/spotify.js';
import { PlayerController } from './modules/player.js';
import { importCredentials } from './modules/credentials.js';
import { readShortcuts, writeShortcuts } from './modules/shortcuts.js';

export default class QuickSpotPreferences extends ExtensionPreferences {
    _lookupSecret(kind, cancel) {
        return lookupSecret(kind, cancel);
    }

    _createPlayer(onChange) {
        return new PlayerController(onChange);
    }

    _createSpotify() {
        return new SpotifyClient();
    }

    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const cancel = new Gio.Cancellable();
        const spotify = this._createSpotify();
        const login = new SpotifyLogin(spotify);
        let closed = false;
        let busy = false;
        let updating = false;
        let librarySaved = false;
        let accountChanged = false;
        let loggingIn = false;
        const controls = [];
        const entries = [];
        const page = new Adw.PreferencesPage({
            title: 'Player',
            icon_name: 'audio-x-generic-symbolic',
        });
        const playerGroup = new Adw.PreferencesGroup({
            title: 'Spotify speaker',
        });
        const status = new Adw.ActionRow({
            title: 'Checking player…',
            subtitle: 'Checking installation and connection.',
        });
        playerGroup.add(status);
        const feedback = new Adw.PreferencesGroup();
        const message = new Adw.ActionRow({
            title: 'QuickSpot',
            visible: false,
        });
        feedback.add(message);

        const player = this._createPlayer(() => sync());
        const perform = async (callback) => {
            if (busy || closed) return;
            busy = true;
            message.visible = true;
            message.subtitle = 'Working…';
            sync();
            try {
                const result = await callback();
                if (!closed) {
                    message.subtitle = result || 'Done.';
                    window.add_toast(
                        new Adw.Toast({ title: result || 'Done.' }),
                    );
                }
            } catch (error) {
                if (!closed) {
                    message.subtitle = error.message;
                    window.add_toast(
                        new Adw.Toast({ title: error.message, timeout: 8 }),
                    );
                }
            } finally {
                busy = false;
                if (!closed) sync();
            }
        };
        const button = (row, label, callback, available = () => true) => {
            const widget = new Gtk.Button({ label, valign: Gtk.Align.CENTER });
            widget.connect('clicked', () => {
                void perform(callback); // perform owns errors and widget lifetime.
            });
            row.add_suffix(widget);
            controls.push({ widget, available });
            return widget;
        };
        const action = (group, title, subtitle, label, callback, available) => {
            const row = new Adw.ActionRow({ title, subtitle });
            row.activatable_widget = button(row, label, callback, available);
            group.add(row);
            return row;
        };
        const entry = (group, title, secret = false) => {
            const row = secret
                ? new Adw.PasswordEntryRow({ title })
                : new Adw.EntryRow({ title });
            entries.push(row);
            group.add(row);
            return row;
        };
        const launch = (uri) => Gio.AppInfo.launch_default_for_uri(uri, null);
        const reloadLibrary = () => {
            if (!closed)
                settings.set_uint(
                    'account-generation',
                    (settings.get_uint('account-generation') + 1) % 0xffffffff,
                );
        };
        const changedAccount = () => {
            accountChanged = true;
            reloadLibrary();
        };

        const installation = action(
            playerGroup,
            'Player installation',
            'Checking…',
            'Install',
            async () => {
                if (player.state.installed && !player.state.serviceLoaded)
                    await player.repair(this.path);
                else await player.install(this.path);
                return 'Player setup complete. Start it below to pair with Spotify.';
            },
            () => !player.state.checking,
        );
        const runtime = new Adw.ActionRow({
            title: 'Player',
            subtitle: 'Checking…',
        });
        const toggle = button(
            runtime,
            'Start',
            async () => {
                // Refresh first: another window or systemctl may have changed the service.
                await player.refresh();
                const action = player.presentation.running ? 'stop' : 'start';
                await player.control(action);
                return action === 'stop'
                    ? 'Player stopped.'
                    : 'Start requested. The connection status above updates automatically.';
            },
            () => !player.state.checking && player.presentation.canToggle,
        );
        const restart = button(
            runtime,
            'Restart',
            async () => {
                await player.control('restart');
                return 'Restart requested. Waiting for the player to reconnect.';
            },
            () => player.presentation.running,
        );
        runtime.activatable_widget = toggle;
        playerGroup.add(runtime);
        const autostart = new Adw.SwitchRow({
            title: 'Start at login',
            subtitle:
                'Make this computer available in Spotify when you sign in.',
        });
        autostart.connect('notify::active', () => {
            if (updating || closed) return;
            const desired = autostart.active;
            void perform(async () => {
                await player.control(desired ? 'enable' : 'disable');
                return desired
                    ? 'Player will start at login.'
                    : 'Automatic startup disabled.';
            });
        });
        playerGroup.add(autostart);
        page.add(playerGroup);
        page.add(feedback);

        const identity = new Adw.PreferencesGroup({
            title: 'Device setup',
            description:
                'A Soloist API key is required for this speaker. It is separate from the optional playlist login.',
        });
        const device = entry(identity, 'Name shown in Spotify');
        device.text = settings.get_string('device-name');
        button(device, 'Save', async () => {
            settings.set_string('device-name', deviceName(device.text));
            await player.refresh();
            if (player.presentation.running) await player.control('restart');
            return 'Device name saved. A running player restarts to apply the change.';
        });
        const key = entry(identity, 'Soloist API key', true);
        button(key, 'Save', async () => {
            await storeSecret(
                'soloist-key',
                soloistKey(key.text.trim()),
                cancel,
            );
            if (closed) return;
            key.text = '';
            await player.refreshCredentials();
            await player.refresh();
            if (player.presentation.running) await player.control('restart');
            return 'API key saved in GNOME Keyring.';
        });
        const keyStatus = new Adw.ActionRow({
            title: 'Saved API key',
            subtitle: 'Checking GNOME Keyring…',
        });
        identity.add(keyStatus);
        action(
            identity,
            'Get a Soloist API key',
            'Generate your own key with a Spotify Premium account.',
            'Open',
            () => launch('https://developer.spotify.com/dashboard/soloist'),
        );
        action(
            identity,
            'Import credentials',
            'Choose an .env file with SPOTIFY_SOLOIST_KEY and/or SPOTIFY_CLIENT_ID.',
            'Import…',
            async () => {
                const dialog = new Gtk.FileDialog({
                    title: 'Choose your Spotify .env file',
                });
                const file = await new Promise((resolve, reject) => {
                    dialog.open(window, cancel, (source, result) => {
                        try {
                            resolve(source.open_finish(result));
                        } catch (_error) {
                            reject(new Error('Credential import canceled.'));
                        }
                    });
                });
                const result = await importCredentials(file, cancel);
                if (closed) return;
                if (result.clientId) clientId.text = result.clientId;
                await player.refreshCredentials();
                await player.refresh();
                if (result.keySaved && player.presentation.running)
                    await player.control('restart');
                return 'Credentials imported. Start the player to pair; connect the playlist library separately.';
            },
        );
        page.add(identity);

        const pairing = new Adw.PreferencesGroup({
            title: 'Pair with Spotify',
            description:
                'First pairing requires the Spotify phone or desktop app on the same local network.',
        });
        pairing.add(
            new Adw.ActionRow({
                title: 'Select your device in Spotify',
                subtitle:
                    'Start the player, open Spotify’s device menu, and select the name above. Once paired, QuickSpot remembers the account. Connect the same account on the Library page to play Liked Songs.',
            }),
        );
        const troubleshooting = new Adw.ExpanderRow({
            title: 'Device missing from Spotify?',
            subtitle: 'Check app, network, and discovery.',
        });
        for (const [title, subtitle] of [
            [
                'Use the phone or desktop app for first pairing',
                'The web player cannot discover an unpaired local speaker.',
            ],
            [
                'Use the same local network',
                'Guest Wi-Fi, client isolation, and VPN routing can block discovery.',
            ],
            [
                'Allow local discovery',
                'Your network needs multicast DNS (UDP 5353) and the player’s advertised TCP port. Do not disable the firewall.',
            ],
            [
                'Check readiness above',
                'Check installation, local connection, and pairing above. Restart the player if its local connection remains unavailable.',
            ],
        ])
            troubleshooting.add_row(new Adw.ActionRow({ title, subtitle }));
        pairing.add(troubleshooting);
        action(
            pairing,
            'Spotify pairing guide',
            'Instructions for connecting a Soloist device.',
            'Open',
            () =>
                launch(
                    'https://developer.spotify.com/documentation/soloist/concepts/authentication',
                ),
        );
        page.add(pairing);
        const quality = new Adw.PreferencesGroup({ title: 'Audio quality' });
        quality.add(
            new Adw.ActionRow({
                title: 'Quality is controlled in Spotify',
                subtitle:
                    'Select this device in Spotify to view or change its quality setting. Soloist does not expose the configured quality level or active bitrate to QuickSpot.',
            }),
        );
        page.add(quality);

        const libraryPage = new Adw.PreferencesPage({
            title: 'Library',
            icon_name: 'view-list-symbolic',
        });
        const account = new Adw.PreferencesGroup({
            title: 'Playlist library',
            description:
                'Connect the same account you paired with the speaker to play Liked Songs and browse saved playlists. Manual playlist shortcuts work without this library login.',
        });
        const clientId = entry(account, 'Spotify client ID');
        const connection = new Adw.ActionRow({
            title: 'Spotify account',
            subtitle: 'Checking saved login…',
        });
        const connect = button(connection, 'Connect', async () => {
            message.subtitle =
                'Finish signing in in your browser. Keep this window open.';
            loggingIn = true;
            sync();
            window.add_toast(
                new Adw.Toast({ title: 'Finish signing in in your browser.' }),
            );
            try {
                await login.connect(clientId.text.trim());
            } finally {
                loggingIn = false;
            }
            if (closed) return;
            librarySaved = true;
            changedAccount();
            return 'Playlist library connected.';
        });
        const cancelLogin = new Gtk.Button({
            label: 'Cancel',
            valign: Gtk.Align.CENTER,
            visible: false,
        });
        cancelLogin.connect('clicked', () => login.cancel());
        connection.add_suffix(cancelLogin);
        button(
            connection,
            'Disconnect',
            async () => {
                await clearSecret('tokens', cancel);
                if (closed) return;
                librarySaved = false;
                changedAccount();
                return 'Saved playlist login removed.';
            },
            () => librarySaved,
        );
        account.add(connection);
        account.add(
            new Adw.ActionRow({
                title: 'Developer app redirect URI',
                subtitle: REDIRECT_URI,
                subtitle_selectable: true,
            }),
        );
        libraryPage.add(account);
        const shortcuts = new Adw.PreferencesGroup({
            title: 'Playlist shortcuts',
            description:
                'Add any playlist, including Discover Weekly, by its 22-character ID, Spotify link, or URI. Choose its name from Playlist shortcuts in the panel to play it on this speaker.',
        });
        const shortcutName = entry(shortcuts, 'Playlist name');
        const shortcutId = entry(shortcuts, 'Playlist ID, link, or URI');
        button(shortcutId, 'Add', () => {
            const playlist = playlistShortcut(
                shortcutName.text,
                shortcutId.text,
            );
            const saved = readShortcuts(settings);
            const existing = saved.some(({ uri }) => uri === playlist.uri);
            if (!existing && saved.length >= 100)
                throw new Error(
                    'Remove a shortcut before adding more than 100 playlists.',
                );
            writeShortcuts(settings, [
                ...saved.filter(({ uri }) => uri !== playlist.uri),
                playlist,
            ]);
            shortcutName.text = '';
            shortcutId.text = '';
            return existing
                ? 'Playlist shortcut updated.'
                : 'Playlist shortcut added.';
        });
        libraryPage.add(shortcuts);
        const savedShortcuts = new Adw.PreferencesGroup({
            title: 'Saved playlist shortcuts',
        });
        libraryPage.add(savedShortcuts);
        let shortcutRows = [];
        function renderShortcuts() {
            if (closed) return;
            for (const { row } of shortcutRows) savedShortcuts.remove(row);
            shortcutRows = [];
            const saved = readShortcuts(settings);
            savedShortcuts.description = saved.length
                ? 'Add the same playlist again with a new name to rename it.'
                : 'No shortcuts yet. Add a playlist above.';
            for (const playlist of saved) {
                const row = new Adw.ActionRow({
                    title: playlist.name,
                    subtitle: playlist.uri,
                    subtitle_selectable: true,
                    use_markup: false,
                });
                const remove = new Gtk.Button({
                    label: 'Remove',
                    valign: Gtk.Align.CENTER,
                });
                remove.connect('clicked', () => {
                    void perform(() => {
                        writeShortcuts(
                            settings,
                            readShortcuts(settings).filter(
                                ({ uri }) => uri !== playlist.uri,
                            ),
                        );
                        return 'Playlist shortcut removed.';
                    });
                });
                row.add_suffix(remove);
                savedShortcuts.add(row);
                shortcutRows.push({ row, remove });
            }
            sync();
        }
        const shortcutsId = settings.connect(
            'changed::playlist-shortcuts',
            renderShortcuts,
        );

        function sync() {
            if (closed) return;
            const view = player.presentation;
            status.title = player.state.checking
                ? 'Checking player…'
                : view.title;
            status.subtitle = view.detail;
            installation.subtitle = player.state.installed
                ? `Soloist ${player.state.version || 'installed'}`
                : 'Not installed';
            installation.activatable_widget.label = view.installLabel;
            toggle.label = view.toggleLabel;
            runtime.subtitle = player.state.checking
                ? 'Checking service…'
                : player.state.activeState;
            restart.visible = view.running;
            keyStatus.subtitle =
                player.state.keyChecked === false
                    ? 'Checking GNOME Keyring…'
                    : player.state.keySaved
                      ? 'Saved securely in GNOME Keyring'
                      : 'No saved key, or keyring is locked';
            connection.subtitle = librarySaved
                ? 'Playlist login saved · reconnect if access expires'
                : 'Not connected';
            connect.label = librarySaved ? 'Reconnect' : 'Connect';
            cancelLogin.visible = loggingIn;
            updating = true;
            autostart.active = player.state.autostart;
            autostart.sensitive = !busy && player.state.serviceLoaded;
            updating = false;
            for (const { widget, available } of controls)
                widget.sensitive = !busy && available();
            for (const row of entries) row.sensitive = !busy;
            for (const { remove } of shortcutRows) remove.sensitive = !busy;
        }

        window.connect('close-request', () => {
            closed = true;
            settings.disconnect(shortcutsId);
            cancel.cancel();
            login.cancel();
            spotify.destroy();
            player.destroy();
            return false;
        });
        window.add(page);
        window.add(libraryPage);
        renderShortcuts();
        player.start();
        // Loading credentials must not prevent Stop or other controls from working.
        void (async () => {
            try {
                const [id, tokens] = await Promise.all([
                    this._lookupSecret('client-id', cancel),
                    this._lookupSecret('tokens', cancel),
                ]);
                if (closed) return;
                if (!clientId.text && id) clientId.text = id;
                if (!accountChanged) librarySaved = Boolean(tokens);
                sync();
            } catch (_error) {
                if (!closed) {
                    message.visible = true;
                    message.subtitle =
                        'Unlock GNOME Keyring to load saved credentials.';
                }
            }
        })();
    }
}
