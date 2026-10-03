// Offline integration tests using real GLib, libsoup, and loopback sockets.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import System from 'system';
import { SoloistClient } from '../modules/soloist.js';
import { SpotifyClient, SpotifyLogin, pkce, REDIRECT_URI } from '../modules/spotify.js';
import { paths, writeService, run } from '../modules/platform.js';
import { importCredentials } from '../modules/credentials.js';
import { likedSongsUri, shuffleMode } from '../modules/model.js';
import { MprisBridge, MPRIS_NAME, MPRIS_PATH } from '../modules/mpris.js';
import { PlayerController } from '../modules/player.js';

function check(condition, message) {
    if (!condition) throw new Error(message);
}

function tick() {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

async function waitFor(predicate) {
    for (let i = 0; i < 200; i++) {
        if (predicate()) return;
        await tick();
    }
    throw new Error('Timed out waiting for native integration state.');
}

function get(session, uri) {
    const message = Soup.Message.new('GET', uri);
    return new Promise((resolve, reject) => {
        session.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            null,
            (source, result) => {
                try {
                    source.send_and_read_finish(result);
                    resolve(message.status_code);
                } catch (error) {
                    reject(error);
                }
            },
        );
    });
}

async function testSoloist() {
    const root = GLib.getenv('QUICKSPOT_TEST_HOME');
    check(
        Boolean(root),
        'Run native tests through scripts/run_native.py for XDG isolation.',
    );
    const data = paths().data;
    check(data.startsWith(`${root}/`), 'XDG data directory is not isolated.');
    GLib.mkdir_with_parents(data, 0o700);
    const server = new Soup.Server();
    const commands = [];
    let activateDevice = true;
    let socket;
    server.add_websocket_handler(
        '/',
        null,
        null,
        (_server, _message, _path, connection) => {
            socket = connection;
            connection.connect('message', (_connection, _type, bytes) => {
                const command = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                commands.push(command);
                if (command.uri === 'spotify:user:rejected:collection') {
                    connection.send_text(
                        JSON.stringify({
                            type: 'error',
                            message: 'private upstream detail',
                        }),
                    );
                    return;
                }
                connection.send_text(
                    JSON.stringify({
                        type: 'command_result',
                        command: command.command,
                    }),
                );
                if (command.command === 'activate' && activateDevice)
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
                        check(
                            commands.at(-1).command === 'activate',
                            'Playback command was sent before device activation.',
                        );
                        connection.send_text(
                            JSON.stringify({
                                type: 'device_changed',
                                is_active: true,
                            }),
                        );
                        return GLib.SOURCE_REMOVE;
                    });
                if (command.command === 'set_shuffle')
                    connection.send_text(
                        JSON.stringify({
                            type: 'options_changed',
                            options: {
                                shuffle: command.enabled,
                                modes: { context_enhancement: 'NONE' },
                            },
                        }),
                    );
                if (['play', 'pause'].includes(command.command))
                    connection.send_text(
                        JSON.stringify({
                            type: 'playback_changed',
                            status: command.command === 'play' ? 'playing' : 'paused',
                        }),
                    );
            });
            connection.send_text(
                JSON.stringify({
                    type: 'auth_state',
                    logged_in: true,
                    is_active: true,
                }),
            );
            connection.send_text(
                JSON.stringify({
                    type: 'playback_state',
                    status: 'playing',
                    volume: 40,
                    is_active: true,
                    item: {
                        uri: 'spotify:track:37i9dQZF1DXcBWIGoYBM5M',
                        decorations: { identity: { name: 'Native test song' } },
                    },
                    options: {
                        shuffle: false,
                        modes: { context_enhancement: 'NONE' },
                    },
                }),
            );
        },
    );
    server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
    const port = server.get_uris()[0].get_port();
    GLib.file_set_contents(`${data}/ws.addr`, '127.0.0.1');
    GLib.file_set_contents(`${data}/ws.port`, String(port));
    const client = new SoloistClient(() => {});
    const bridge = new MprisBridge(client);
    try {
        client.start();
        await waitFor(() => client.state.title === 'Native test song');
        check(client.state.loggedIn, 'Login state never arrived.');
        await client.command('play', '37i9dQZF1DXcBWIGoYBM5M');
        await waitFor(() => commands.length === 1);
        check(
            commands[0].type === 'command' &&
                commands[0].command === 'play' &&
                commands[0].uri === 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M',
            'Wrong playlist command.',
        );
        const collection = likedSongsUri({ id: 'native-test-user' });
        await client.command('play', collection);
        await waitFor(() => commands.length === 2);
        check(commands[1].uri === collection, 'Liked Songs did not reach the player.');
        socket.send_text(JSON.stringify({ type: 'device_changed', is_active: false }));
        await waitFor(() => !client.state.active);
        await client.command('play', collection);
        check(
            commands[2].command === 'activate' &&
                commands[3].command === 'play' &&
                client.state.active,
            'Play did not activate the device first.',
        );
        let rejected = false;
        try {
            await client.command('play', 'spotify:user:rejected:collection');
        } catch (error) {
            rejected = true;
            check(!error.message.includes('upstream'), 'Raw command error escaped.');
        }
        check(rejected, 'Rejected command was reported as successful.');
        await client.command('play');
        await waitFor(() => client.state.status === 'playing');
        bridge.sync();
        const call = (iface, method, parameters = null) =>
            new Promise((resolve, reject) =>
                Gio.DBus.session.call(
                    MPRIS_NAME,
                    MPRIS_PATH,
                    iface,
                    method,
                    parameters,
                    null,
                    Gio.DBusCallFlags.NONE,
                    2000,
                    null,
                    (bus, result) => {
                        try {
                            resolve(bus.call_finish(result));
                        } catch (error) {
                            reject(error);
                        }
                    },
                ),
            );
        await tick();
        const [properties] = (
            await call(
                'org.freedesktop.DBus.Properties',
                'GetAll',
                new GLib.Variant('(s)', ['org.mpris.MediaPlayer2.Player']),
            )
        ).recursiveUnpack();
        check(
            properties.PlaybackStatus === 'Playing' &&
                properties.Metadata['xesam:title'] === 'Native test song' &&
                properties.CanControl,
            'MPRIS properties were not exported correctly.',
        );
        await call('org.mpris.MediaPlayer2.Player', 'PlayPause');
        await waitFor(() => client.state.status === 'paused');
        bridge.sync();
        const [paused] = (
            await call(
                'org.freedesktop.DBus.Properties',
                'Get',
                new GLib.Variant('(ss)', [
                    'org.mpris.MediaPlayer2.Player',
                    'PlaybackStatus',
                ]),
            )
        ).recursiveUnpack();
        check(paused === 'Paused', 'MPRIS pause state did not update.');
        await call('org.mpris.MediaPlayer2.Player', 'PlayPause');
        await waitFor(() => client.state.status === 'playing');
        await call('org.mpris.MediaPlayer2.Player', 'Next');
        check(
            commands.at(-1).command === 'skip_next',
            'MPRIS Next did not reach Soloist.',
        );
        socket.send_text(JSON.stringify({ type: 'device_changed', is_active: false }));
        await waitFor(() => !client.state.active);
        const beforeShuffle = commands.length;
        await call(
            'org.freedesktop.DBus.Properties',
            'Set',
            new GLib.Variant('(ssv)', [
                'org.mpris.MediaPlayer2.Player',
                'Shuffle',
                new GLib.Variant('b', true),
            ]),
        );
        await waitFor(() => client.state.shuffle === true);
        const [activation, shuffleCommand] = commands.slice(beforeShuffle);
        check(
            activation.command === 'activate' &&
                shuffleCommand.command === 'set_shuffle' &&
                shuffleCommand.enabled === true &&
                client.state.active,
            'Desktop shuffle did not activate the speaker before changing shuffle.',
        );
        await client.setShuffle(false);
        await waitFor(() => shuffleMode(client.state) === 'off');
        socket.send_text(
            JSON.stringify({
                type: 'options_changed',
                options: {
                    shuffle: true,
                    modes: { context_enhancement: 'RECOMMENDATION' },
                },
            }),
        );
        await waitFor(() => shuffleMode(client.state) === 'smart');
        bridge.sync();
        const [shuffled] = (
            await call(
                'org.freedesktop.DBus.Properties',
                'Get',
                new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Shuffle']),
            )
        ).recursiveUnpack();
        check(shuffled === true, 'Smart Shuffle was not exposed as shuffled playback.');
        print(
            'PASS: inactive speaker shuffle activation, remote Smart Shuffle updates, and MPRIS shuffle',
        );
        socket.send_text(JSON.stringify({ type: 'device_changed', is_active: false }));
        await waitFor(() => !client.state.active);
        activateDevice = false;
        const beforeFailedActivation = commands.length;
        let activationRejected = false;
        try {
            await client.setShuffle(false);
        } catch (error) {
            activationRejected = error.message.includes('did not activate');
        }
        check(
            activationRejected &&
                commands.length === beforeFailedActivation + 1 &&
                commands.at(-1).command === 'activate',
            'Shuffle was sent despite an activation acknowledgement without activation.',
        );
        activateDevice = true;
        await client.setShuffle(false);
        await waitFor(() => client.state.active && !client.state.shuffle);
        print('PASS: failed activation blocks shuffle and subsequent retry succeeds');
        print(
            'PASS: real MPRIS discovery, metadata, play/pause, and next over a private D-Bus session',
        );
        socket.send_text('{invalid');
        await waitFor(() => Boolean(client.state.error));
        check(
            client.state.title === 'Native test song',
            'Malformed event changed metadata.',
        );
        socket.send_text(
            JSON.stringify({ type: 'playback_changed', status: 'paused' }),
        );
        await waitFor(() => client.state.status === 'paused' && !client.state.error);
        socket.send_text(
            JSON.stringify({ type: 'error', message: 'upstream diagnostic' }),
        );
        await waitFor(() => Boolean(client.state.error));
        check(
            !client.state.error.includes('upstream'),
            'Raw server diagnostic reached the UI.',
        );
        socket.close(1000, null);
        await waitFor(() => !client.state.connected);
        check(
            !client.state.title && !client.state.loggedIn,
            'Disconnect left stale playback.',
        );
        print(
            'PASS: native Soloist events, playlist and Liked Songs commands, errors, and disconnect',
        );
    } finally {
        bridge.destroy();
        client.destroy();
        server.disconnect();
        for (const file of ['ws.addr', 'ws.port'])
            Gio.File.new_for_path(`${data}/${file}`).delete(null);
        Gio.File.new_for_path(data).delete(null);
        Gio.File.new_for_path(`${root}/quickspot`).delete(null);
    }
}

async function testLogin() {
    check(
        pkce('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk') ===
            'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        'PKCE differs from RFC 7636.',
    );
    let authUrl;
    let exchange;
    const saved = new Map();
    const client = {
        request: async (method, uri, body) => {
            exchange = { method, uri, body };
            return {
                access_token: 'fake-access',
                refresh_token: 'fake-refresh',
                token_type: 'Bearer',
                expires_in: 3600,
            };
        },
    };
    const login = new SpotifyLogin(client, {
        launch: uri => {
            authUrl = uri;
        },
        save: async (kind, value) => saved.set(kind, value),
    });
    const session = new Soup.Session();
    const complete = login.connect('0123456789abcdef0123456789abcdef');
    try {
        await waitFor(() => Boolean(authUrl));
        const query = GLib.Uri.parse_params(
            authUrl.split('?')[1],
            -1,
            '&',
            GLib.UriParamsFlags.NONE,
        );
        check(
            query.redirect_uri === REDIRECT_URI &&
                query.code_challenge_method === 'S256',
            'Incorrect OAuth parameters.',
        );
        check(
            (await get(session, `${REDIRECT_URI}?state=wrong&code=fake-code`)) === 400,
            'Invalid OAuth state was accepted.',
        );
        check(!exchange, 'Token exchange happened before a valid callback.');
        check(
            (await get(
                session,
                `${REDIRECT_URI}?state=${query.state}&code=fake-code`,
            )) === 200,
            'Valid callback was rejected.',
        );
        await complete;
        check(
            pkce(exchange.body.code_verifier) === query.code_challenge,
            'Token verifier does not match challenge.',
        );
        check(
            exchange.body.code === 'fake-code' && !('client_secret' in exchange.body),
            'Incorrect PKCE exchange.',
        );
        check(
            JSON.parse(saved.get('tokens')).refresh === 'fake-refresh',
            'Login tokens were not stored.',
        );
        print(
            'PASS: PKCE RFC vector, OAuth state validation, callback, and token storage',
        );
    } finally {
        login.cancel();
        session.abort();
    }

    const canceled = new SpotifyLogin(client, {
        launch: () => {},
        save: async () => {},
    });
    const pending = canceled.connect('0123456789abcdef0123456789abcdef');
    canceled.cancel();
    try {
        await pending;
        throw new Error('Canceled login succeeded.');
    } catch (error) {
        check(error.message === 'Spotify login canceled.', 'Unexpected cancel result.');
    }
    print('PASS: canceled login releases its loopback listener');
}

async function testPagination() {
    const client = new SpotifyClient();
    client.accessToken = async () => 'fake-access';
    let requests = 0;
    client.request = async () => {
        requests++;
        return {
            items: [
                {
                    name: requests === 1 ? 'Zed' : 'Alpha',
                    uri:
                        requests === 1
                            ? 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M'
                            : 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5N',
                },
            ],
            next:
                requests === 1
                    ? 'https://api.spotify.com/v1/me/playlists?offset=50'
                    : null,
        };
    };
    try {
        const items = await client.playlists();
        check(
            requests === 2 && items[0].name === 'Alpha' && items.length === 2,
            'Pagination or sorting failed.',
        );
        client.request = async () => ({
            items: [],
            next: 'https://api.spotify.com/v1/me/playlists?limit=50',
        });
        let rejected = false;
        try {
            await client.playlists();
        } catch {
            rejected = true;
        }
        check(rejected, 'Repeated page was not rejected.');
        print('PASS: native playlist pagination, sorting, and repeated page rejection');
    } finally {
        client.destroy();
    }
}

async function testLoginCancellationDuringExchange() {
    const saved = new Map();
    let authUrl;
    let finishExchange;
    let exchangeCancel;
    const response = {
        access_token: 'fake-access',
        refresh_token: 'fake-refresh',
        token_type: 'Bearer',
        expires_in: 3600,
    };
    const client = {
        request: async (_method, _uri, _body, _access, cancel) => {
            if (!finishExchange) {
                exchangeCancel = cancel;
                return new Promise(resolve => {
                    finishExchange = resolve;
                });
            }
            return response;
        },
    };
    const login = new SpotifyLogin(client, {
        launch: uri => {
            authUrl = uri;
        },
        save: async (kind, value) => saved.set(kind, value),
    });
    const session = new Soup.Session();
    const state = () =>
        GLib.Uri.parse_params(authUrl.split('?')[1], -1, '&', GLib.UriParamsFlags.NONE)
            .state;
    const first = login.connect('0123456789abcdef0123456789abcdef');
    const firstResult = first.then(
        () => '',
        error => error.message,
    );
    try {
        await get(session, `${REDIRECT_URI}?state=${state()}&code=first`);
        await waitFor(() => Boolean(finishExchange));
        login.cancel();
        const second = login.connect('abcdef0123456789abcdef0123456789');
        const secondResult = second.then(
            () => '',
            error => error.message,
        );
        finishExchange(response);

        check(
            (await firstResult) === 'Spotify login canceled.',
            'Canceled token exchange reported success.',
        );
        check(saved.size === 0, 'Canceled exchange saved credentials.');
        check(exchangeCancel?.is_cancelled(), 'Token exchange was not canceled.');
        check(
            (await get(session, `${REDIRECT_URI}?state=${state()}&code=second`)) ===
                200,
            'Old login cleanup closed the new login listener.',
        );
        check((await secondResult) === '', 'Reconnect failed.');
        check(
            JSON.parse(saved.get('tokens')).clientId ===
                'abcdef0123456789abcdef0123456789',
            'Login tokens were not bound to their developer app.',
        );
        print(
            'PASS: cancel during token exchange blocks storage and permits immediate reconnect',
        );
    } finally {
        login.cancel();
        session.abort();
    }
}

async function testRefresh() {
    const stored = new Map([
        [
            'tokens',
            JSON.stringify({
                access: 'expired',
                refresh: 'original-refresh',
                expires: 0,
                clientId: 'abcdef0123456789abcdef0123456789',
            }),
        ],
        ['client-id', '0123456789abcdef0123456789abcdef'],
    ]);
    const client = new SpotifyClient({
        lookup: async kind => stored.get(kind),
        save: async (kind, value) => stored.set(kind, value),
    });
    let requests = 0;
    client.request = async (_method, _uri, body) => {
        requests++;
        check(
            body.refresh_token === 'original-refresh',
            'Refresh used the wrong token.',
        );
        check(
            body.client_id === 'abcdef0123456789abcdef0123456789',
            'Refresh used an imported client ID from a different developer app.',
        );
        await tick();
        return {
            access_token: 'fresh',
            token_type: 'Bearer',
            expires_in: 3600,
        };
    };
    try {
        const tokens = await Promise.all([client.accessToken(), client.accessToken()]);
        check(
            requests === 1 && tokens.every(value => value === 'fresh'),
            'Concurrent refresh was not shared.',
        );
        check(
            JSON.parse(stored.get('tokens')).refresh === 'original-refresh',
            'Refresh discarded the existing token.',
        );
        check(
            (await client.accessToken()) === 'fresh' && requests === 1,
            'Unexpired token was refreshed unnecessarily.',
        );
        print('PASS: expired token refresh, concurrency, persistence, and reuse');
    } finally {
        client.destroy();
    }
}

const loop = new GLib.MainLoop(null, false);
let exitCode = 0;
async function main() {
    try {
        await testSoloist();
        await testLogin();
        await testLoginCancellationDuringExchange();
        await testPagination();
        await testRefresh();
        const actions = [];
        let activeState = 'active';
        const player = new PlayerController(() => {}, {
            probe: async () => ({
                serviceLoaded: true,
                activeState,
                autostart: false,
            }),
            lookup: async () => 'fake-key',
            control: async (action, cancel) => {
                check(
                    !cancel?.is_cancelled(),
                    'Canceled operation prevented rollback.',
                );
                actions.push(action);
                activeState = action === 'stop' ? 'inactive' : 'active';
            },
            command: async () => {
                player.destroy();
                throw new Error('Test canceled download');
            },
        });
        try {
            let failure = '';
            try {
                await player.install('/test/quickspot');
            } catch (error) {
                failure = error.message;
            }
            check(
                failure === 'Test canceled download',
                'Update lost its failure message.',
            );
            check(
                actions.join(',') === 'stop,start' && activeState === 'active',
                'Canceled update left the existing player stopped.',
            );
            print('PASS: canceled update restores the previously running player');
        } finally {
            player.destroy();
        }
        const guarded = new SpotifyClient();
        try {
            for (const uri of [
                'https://example.invalid/v1/me/playlists',
                'https://api.spotify.com.evil/v1/me/playlists',
                'https://api.spotify.com/v1/me/playlists'.replace('https:', 'http:'),
            ]) {
                let blocked = false;
                try {
                    await guarded.request('GET', uri, null, 'fake-access');
                } catch (error) {
                    blocked =
                        error.message === 'Unexpected Spotify request destination.';
                }
                check(blocked, 'Bearer-token request was allowed to leave Spotify.');
            }
            print(
                'PASS: request boundary blocks bearer tokens to unexpected destinations',
            );
        } finally {
            guarded.destroy();
        }
        const credentials = Gio.File.new_for_path(
            `${GLib.getenv('QUICKSPOT_TEST_HOME')}/credentials.env`,
        );
        const stored = new Map();
        const save = async (kind, value) => stored.set(kind, value);
        GLib.file_set_contents(
            credentials.get_path(),
            'SPOTIFY_SOLOIST_KEY=fake-test-key\n',
        );
        await importCredentials(credentials, null, save);
        check(
            stored.get('soloist-key') === 'fake-test-key',
            'Soloist-only import failed.',
        );
        stored.clear();
        GLib.file_set_contents(
            credentials.get_path(),
            'SPOTIFY_CLIENT_ID=0123456789abcdef0123456789abcdef\nSPOTIFY_SOLOIST_KEY=invalid key\n',
        );
        let rejected = false;
        try {
            await importCredentials(credentials, null, save);
        } catch {
            rejected = true;
        }
        check(
            rejected && stored.size === 0,
            'Invalid import partially changed saved credentials.',
        );
        credentials.delete(null);
        print(
            'PASS: bounded credential import, Soloist-only setup, and validation before storage',
        );
        const extensionPath = GLib.path_get_dirname(
            GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]),
        );
        writeService(`${extensionPath}/a b"c\\d\${QUICKSPOT_TEST}%x`);
        const unitFile = Gio.File.new_for_path(
            `${GLib.get_user_config_dir()}/systemd/user/quickspot-soloist.service`,
        );
        const [, unitBytes] = unitFile.load_contents(null);
        const unit = new TextDecoder().decode(unitBytes);
        check(
            unit.includes(
                '/a b\\"c\\\\d$${QUICKSPOT_TEST}%%x/scripts/soloist-runner.js"',
            ),
            'Service paths did not preserve quotes, backslashes, variables, and specifiers.',
        );
        let invalidPath = false;
        try {
            writeService(`${extensionPath}\nExecStart=/unexpected`);
        } catch {
            invalidPath = true;
        }
        check(invalidPath, 'Service path accepted an injected unit directive.');
        writeService(extensionPath);
        await run([
            '/usr/bin/systemd-analyze',
            '--user',
            'verify',
            `${GLib.get_user_config_dir()}/systemd/user/quickspot-soloist.service`,
        ]);
        print('PASS: generated systemd user service validates');
    } catch (error) {
        printerr(error.stack);
        exitCode = 1;
    } finally {
        loop.quit();
    }
}
void main(); // GLib keeps the offline integration suite alive.
loop.run();
System.exit(exitCode);
