// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import { lookupSecret, storeSecret } from './secrets.js';
import {
    likedSongsUri,
    playlistPage,
    savedToken,
    tokenRecord,
} from './model.js';

export const REDIRECT_URI = 'http://127.0.0.1:43821/callback';

export function form(values) {
    return Object.entries(values)
        .map(
            ([key, value]) =>
                `${GLib.Uri.escape_string(key, null, false)}=${GLib.Uri.escape_string(value, null, false)}`,
        )
        .join('&');
}

export function pkce(verifier) {
    const hex = GLib.compute_checksum_for_string(
        GLib.ChecksumType.SHA256,
        verifier,
        -1,
    );
    const bytes = Uint8Array.from(hex.match(/../g), (pair) =>
        Number.parseInt(pair, 16),
    );
    return GLib.base64_encode(bytes)
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '');
}

function randomString() {
    const stream = Gio.File.new_for_path('/dev/urandom').read(null);
    try {
        const bytes = stream.read_bytes(32, null).get_data();
        if (bytes.length !== 32)
            throw new Error('Could not generate login randomness.');
        return Array.from(bytes, (value) =>
            value.toString(16).padStart(2, '0'),
        ).join('');
    } finally {
        stream.close(null);
    }
}

export class SpotifyClient {
    constructor({ lookup = lookupSecret, save = storeSecret } = {}) {
        this._lookup = lookup;
        this._save = save;
        this._session = new Soup.Session({ timeout: 20 });
        this._cancel = new Gio.Cancellable();
        this._refresh = null;
        this.retryAt = 0;
    }

    async request(
        method,
        uri,
        body = null,
        access = null,
        cancel = this._cancel,
    ) {
        const library =
            method === 'GET' &&
            typeof uri === 'string' &&
            uri.length <= 4096 &&
            [
                'https://api.spotify.com/v1/me/playlists',
                'https://api.spotify.com/v1/me',
            ].includes(uri.split('?')[0]) &&
            !/[\s#]/u.test(uri);
        const token =
            method === 'POST' &&
            uri === 'https://accounts.spotify.com/api/token' &&
            !access;
        if (!library && !token)
            throw new Error('Unexpected Spotify request destination.');
        if (this._cancel.is_cancelled() || cancel.is_cancelled())
            throw new Error('Operation canceled.');
        if (Date.now() < this.retryAt)
            throw new Error('Spotify is busy. Try refreshing later.');
        const message = Soup.Message.new(method, uri);
        message.set_flags(Soup.MessageFlags.NO_REDIRECT);
        if (access)
            message.request_headers.append('Authorization', `Bearer ${access}`);
        if (body)
            message.set_request_body_from_bytes(
                'application/x-www-form-urlencoded',
                new GLib.Bytes(new TextEncoder().encode(form(body))),
            );
        const stream = await new Promise((resolve, reject) => {
            this._session.send_async(
                message,
                GLib.PRIORITY_DEFAULT,
                cancel,
                (session, result) => {
                    try {
                        resolve(session.send_finish(result));
                    } catch (_error) {
                        reject(
                            new Error(
                                'Could not reach Spotify. Check your connection.',
                            ),
                        );
                    }
                },
            );
        });
        const chunks = [];
        let size = 0;
        try {
            while (true) {
                const chunk = await new Promise((resolve, reject) => {
                    stream.read_bytes_async(
                        16384,
                        GLib.PRIORITY_DEFAULT,
                        cancel,
                        (source, result) => {
                            try {
                                resolve(
                                    source.read_bytes_finish(result).get_data(),
                                );
                            } catch (_error) {
                                reject(
                                    new Error(
                                        'Could not read Spotify response.',
                                    ),
                                );
                            }
                        },
                    );
                });
                if (!chunk.length) break;
                size += chunk.length;
                if (size > 2 * 1024 * 1024)
                    throw new Error('Spotify response is too large.');
                chunks.push(chunk);
            }
        } finally {
            stream.close(null);
        }
        const status = message.status_code;
        if (status === 429) {
            const retry = message.response_headers.get_one('Retry-After');
            const seconds = retry ? Number(retry) : NaN;
            this.retryAt =
                Date.now() +
                (Number.isFinite(seconds) ? Math.max(1, seconds) : 60) * 1000;
            throw new Error('Spotify is busy. Try refreshing later.');
        }
        if (status === 401)
            throw new Error('Spotify login expired. Reconnect in settings.');
        if (status === 403)
            throw new Error(
                'Spotify denied access. Check your app’s allowed users and permissions.',
            );
        if (status < 200 || status >= 300)
            throw new Error(`Spotify request failed (HTTP ${status}).`);
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
        }
        try {
            return JSON.parse(new TextDecoder().decode(bytes));
        } catch (_error) {
            throw new Error('Spotify returned an invalid response.');
        }
    }

    async accessToken() {
        if (this._refresh) return this._refresh;
        const raw = await this._lookup('tokens', this._cancel);
        if (!raw) throw new Error('Connect Spotify in QuickSpot settings.');
        let token;
        try {
            token = savedToken(JSON.parse(raw));
        } catch (_error) {
            throw new Error('Reconnect Spotify in QuickSpot settings.');
        }
        if (token.expires > Date.now() + 60000) return token.access;
        if (this._refresh) return this._refresh;
        this._refresh = this._refreshToken(token);
        try {
            return await this._refresh;
        } finally {
            this._refresh = null;
        }
    }

    async _refreshToken(token) {
        const clientId =
            token.clientId ?? (await this._lookup('client-id', this._cancel));
        if (!clientId || !/^[a-fA-F0-9]{32}$/.test(clientId))
            throw new Error('Set your Spotify client ID in settings.');
        const response = await this.request(
            'POST',
            'https://accounts.spotify.com/api/token',
            {
                client_id: clientId,
                grant_type: 'refresh_token',
                refresh_token: token.refresh,
            },
        );
        const updated = { ...tokenRecord(response, token.refresh), clientId };
        await this._save('tokens', JSON.stringify(updated), this._cancel);
        return updated.access;
    }

    async playlists() {
        const access = await this.accessToken();
        const items = new Map();
        const visited = new Set();
        let next = 'https://api.spotify.com/v1/me/playlists?limit=50';
        while (next) {
            if (visited.has(next) || visited.size >= 200)
                throw new Error('Spotify returned too many playlist pages.');
            visited.add(next);
            const page = playlistPage(
                await this.request('GET', next, null, access),
            );
            for (const item of page.items) items.set(item.uri, item);
            next = page.next;
        }
        return [...items.values()].sort((a, b) => a.name.localeCompare(b.name));
    }

    async likedSongs() {
        const access = await this.accessToken();
        return likedSongsUri(
            await this.request(
                'GET',
                'https://api.spotify.com/v1/me',
                null,
                access,
            ),
        );
    }

    destroy() {
        this._cancel.cancel();
        this._session.abort();
    }
}

// The preferences process owns the temporary loopback listener. Closing the
// window cancels login, shuts the listener down, and cancels the token exchange.
export class SpotifyLogin {
    constructor(
        client,
        {
            launch = (uri) => Gio.AppInfo.launch_default_for_uri(uri, null),
            save = storeSecret,
        } = {},
    ) {
        this._client = client;
        this._launch = launch;
        this._save = save;
        this._attempt = null;
    }

    async connect(clientId) {
        if (this._attempt)
            throw new Error('Spotify login is already in progress.');
        if (!/^[a-fA-F0-9]{32}$/.test(clientId))
            throw new Error('Enter a valid Spotify client ID.');
        const verifier = randomString();
        const state = randomString();
        const server = new Soup.Server();
        server.listen_local(43821, Soup.ServerListenOptions.IPV4_ONLY);
        const attempt = {
            server,
            cancel: new Gio.Cancellable(),
            timeout: 0,
            reject: null,
            error: null,
        };
        this._attempt = attempt;
        const codePromise = new Promise((resolve, reject) => {
            attempt.reject = reject;
            let used = false;
            server.add_handler(
                '/callback',
                (_server, message, _path, query) => {
                    if (
                        used ||
                        message.get_method() !== 'GET' ||
                        _path !== '/callback' ||
                        query?.state !== state
                    ) {
                        message.set_status(400, null);
                        message.set_response(
                            'text/plain',
                            Soup.MemoryUse.COPY,
                            new TextEncoder().encode('Invalid login callback.'),
                        );
                        return;
                    }
                    if (
                        query.error ||
                        typeof query.code !== 'string' ||
                        !query.code ||
                        query.code.length > 2048
                    ) {
                        message.set_status(400, null);
                        message.set_response(
                            'text/plain',
                            Soup.MemoryUse.COPY,
                            new TextEncoder().encode(
                                'Login canceled. Return to QuickSpot.',
                            ),
                        );
                        used = true;
                        reject(new Error('Spotify login was canceled.'));
                        return;
                    }
                    used = true;
                    message.set_status(200, null);
                    message.set_response(
                        'text/plain',
                        Soup.MemoryUse.COPY,
                        new TextEncoder().encode(
                            'Return to QuickSpot to finish connecting. You can close this tab.',
                        ),
                    );
                    resolve(query.code);
                },
            );
            attempt.timeout = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT,
                180,
                () => {
                    attempt.timeout = 0;
                    this._cancelAttempt(
                        attempt,
                        new Error(
                            'Spotify login timed out. Try connecting again.',
                        ),
                    );
                    return GLib.SOURCE_REMOVE;
                },
            );
        });
        // Attach a rejection handler immediately, including browser launch failure.
        const result = this._finish(codePromise, clientId, verifier, attempt);
        try {
            this._launch(
                'https://accounts.spotify.com/authorize?' +
                    form({
                        client_id: clientId,
                        response_type: 'code',
                        redirect_uri: REDIRECT_URI,
                        scope: 'playlist-read-private playlist-read-collaborative',
                        state,
                        code_challenge_method: 'S256',
                        code_challenge: pkce(verifier),
                    }),
            );
        } catch (_error) {
            this.cancel();
        }
        return result;
    }

    async _finish(codePromise, clientId, verifier, attempt) {
        const checkCanceled = () => {
            if (attempt.cancel.is_cancelled()) throw attempt.error;
        };
        try {
            const code = await codePromise;
            checkCanceled();
            const response = await this._client.request(
                'POST',
                'https://accounts.spotify.com/api/token',
                {
                    client_id: clientId,
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: REDIRECT_URI,
                    code_verifier: verifier,
                },
                null,
                attempt.cancel,
            );
            checkCanceled();
            await this._save(
                'tokens',
                JSON.stringify({ ...tokenRecord(response), clientId }),
                attempt.cancel,
            );
            checkCanceled();
            await this._save('client-id', clientId, attempt.cancel);
            checkCanceled();
        } catch (error) {
            if (attempt.cancel.is_cancelled()) throw attempt.error;
            throw error;
        } finally {
            this._cleanup(attempt);
        }
    }

    _cleanup(attempt) {
        if (attempt.timeout) GLib.Source.remove(attempt.timeout);
        attempt.timeout = 0;
        attempt.server.disconnect();
        if (this._attempt === attempt) this._attempt = null;
    }

    _cancelAttempt(attempt, error) {
        attempt.error = error;
        attempt.cancel.cancel();
        attempt.reject(error);
        this._cleanup(attempt);
    }

    cancel() {
        if (this._attempt)
            this._cancelAttempt(
                this._attempt,
                new Error('Spotify login canceled.'),
            );
    }
}
