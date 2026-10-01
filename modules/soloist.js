// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import { paths } from './platform.js';
import { playbackEvent, playbackUri } from './model.js';

export class SoloistClient {
    constructor(onChange) {
        this._onChange = onChange;
        this._session = new Soup.Session({ timeout: 3 });
        this._cancel = new Gio.Cancellable();
        this._socket = null;
        this._connecting = false;
        this._signals = [];
        this._commands = Promise.resolve();
        this._pending = null;
        this.state = {
            connected: false,
            loggedIn: false,
            active: false,
            status: 'idle',
            title: '',
            artist: '',
            volume: 0,
            error: '',
        };
        this._timer = 0;
    }

    start() {
        if (this._timer || this._cancel.is_cancelled()) return;
        this._connect();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3, () => {
            if (!this._socket) this._connect();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _read(file) {
        const source = Gio.File.new_for_path(`${paths().data}/${file}`);
        const info = source.query_info(
            'standard::type,standard::size',
            Gio.FileQueryInfoFlags.NONE,
            null,
        );
        if (
            info.get_file_type() !== Gio.FileType.REGULAR ||
            info.get_size() > 64
        )
            throw new Error('Invalid local endpoint file.');
        const [, contents] = source.load_contents(null);
        return new TextDecoder().decode(contents).trim();
    }

    _connect() {
        if (this._connecting || this._cancel.is_cancelled()) return;
        let uri;
        try {
            const address = this._read('ws.addr');
            const portText = this._read('ws.port');
            const port = Number(portText);
            if (
                address !== '127.0.0.1' ||
                !/^\d{1,5}$/.test(portText) ||
                port < 1 ||
                port > 65535
            )
                throw new Error('Soloist endpoint must use IPv4 loopback.');
            uri = `ws://127.0.0.1:${port}`;
        } catch (_error) {
            return;
        }
        this._connecting = true;
        this._session.websocket_connect_async(
            Soup.Message.new('GET', uri),
            null,
            null,
            GLib.PRIORITY_DEFAULT,
            this._cancel,
            (session, result) => {
                this._connecting = false;
                let socket;
                try {
                    socket = session.websocket_connect_finish(result);
                } catch (_error) {
                    return;
                }
                if (this._cancel.is_cancelled()) {
                    socket.close(1000, null);
                    return;
                }
                this._socket = socket;
                socket.set_max_incoming_payload_size(2 * 1024 * 1024);
                this._signals = [
                    socket.connect('message', (_socket, type, bytes) => {
                        if (type !== Soup.WebsocketDataType.TEXT) return;
                        try {
                            const event = JSON.parse(
                                new TextDecoder().decode(bytes.get_data()),
                            );
                            if (
                                event.type === 'command_result' &&
                                event.command === this._pending?.command
                            )
                                this._settleCommand();
                            else if (event.type === 'error')
                                this._settleCommand(
                                    new Error(
                                        'Soloist rejected the command. Check pairing and the selected Spotify account.',
                                    ),
                                );
                            this.state = playbackEvent(this.state, event);
                            this.state.error =
                                event.type === 'error'
                                    ? 'Soloist could not perform that command. Check pairing and device state.'
                                    : '';
                        } catch (_error) {
                            this.state.error =
                                'Soloist sent an invalid playback update.';
                        }
                        this._onChange?.();
                    }),
                    socket.connect('closed', () => this._disconnect()),
                    socket.connect('error', () => {
                        this.state.error = 'Soloist connection interrupted.';
                        this._disconnect();
                    }),
                ];
                this.state.connected = true;
                this._onChange?.();
            },
        );
    }

    command(command, uri = null) {
        if (
            !['play', 'pause', 'skip_next', 'skip_prev', 'activate'].includes(
                command,
            )
        )
            return Promise.reject(new Error('Invalid playback command.'));
        let message;
        try {
            message = { type: 'command', command };
            if (uri !== null) message.uri = playbackUri(uri);
        } catch (error) {
            return Promise.reject(error);
        }
        return this._enqueue(async () => {
            if (command === 'play' && !this.state.active) {
                await this._dispatch({ type: 'command', command: 'activate' });
                // An acknowledgement means dispatched; wait for actual activation.
                const deadline = GLib.get_monotonic_time() + 5000000;
                while (!this.state.active) {
                    if (
                        !this.state.connected ||
                        this._cancel.is_cancelled() ||
                        GLib.get_monotonic_time() > deadline
                    )
                        throw new Error(
                            'Spotify did not activate this device. Select it in Spotify and try again.',
                        );
                    await new Promise((resolve) =>
                        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                            resolve();
                            return GLib.SOURCE_REMOVE;
                        }),
                    );
                }
            }
            return this._dispatch(message);
        });
    }

    setVolume(volume) {
        if (!Number.isFinite(volume) || volume < 0 || volume > 100)
            return Promise.reject(new Error('Invalid playback volume.'));
        return this._enqueue(() =>
            this._dispatch({ type: 'command', command: 'set_volume', volume }),
        );
    }

    _enqueue(callback) {
        const result = this._commands.then(callback);
        this._commands = result.catch(() => {});
        return result;
    }

    _dispatch(message) {
        if (!this._socket || !this.state.loggedIn)
            throw new Error(
                'Start Soloist and pair it from Spotify’s device menu first.',
            );
        return new Promise((resolve, reject) => {
            const timer = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT,
                5,
                () => {
                    this._pending.timer = 0;
                    this._settleCommand(
                        new Error(
                            'Soloist did not acknowledge the command. Try again.',
                        ),
                    );
                    // Without request IDs, a late acknowledgement could otherwise
                    // complete the next command of the same type.
                    this._disconnect();
                    return GLib.SOURCE_REMOVE;
                },
            );
            this._pending = {
                command: message.command,
                resolve,
                reject,
                timer,
            };
            try {
                this._socket.send_text(JSON.stringify(message));
            } catch (_error) {
                this._settleCommand(
                    new Error('Soloist connection interrupted.'),
                );
            }
        });
    }

    _settleCommand(error = null) {
        const pending = this._pending;
        this._pending = null;
        if (!pending) return;
        if (pending.timer) GLib.Source.remove(pending.timer);
        if (error) pending.reject(error);
        else pending.resolve();
    }

    _disconnect() {
        this._settleCommand(new Error('Soloist connection interrupted.'));
        const socket = this._socket;
        this._socket = null;
        if (socket) {
            for (const id of this._signals) socket.disconnect(id);
            if (socket.get_state() === Soup.WebsocketState.OPEN)
                socket.close(1000, null);
        }
        this._signals = [];
        this.state = {
            ...this.state,
            connected: false,
            loggedIn: false,
            active: false,
            status: 'idle',
            title: '',
            artist: '',
            uri: '',
            duration: 0,
            position: null,
            context: '',
        };
        this._onChange?.();
    }

    destroy() {
        this._onChange = null;
        this._cancel.cancel();
        if (this._timer) GLib.Source.remove(this._timer);
        this._timer = 0;
        this._disconnect();
        this._session.abort();
    }
}
