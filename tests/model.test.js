import assert from 'node:assert/strict';
import test from 'node:test';
import {
    playlistUri,
    playlistPage,
    playlistShortcut,
    playlistShortcuts,
    shuffleMode,
    tokenRecord,
    savedToken,
    playbackEvent,
    parseEnvironment,
    playbackUri,
    likedSongsUri,
    deviceName,
    soloistKey,
    playerPresentation,
} from '../modules/model.js';

const id = '37i9dQZF1DXcBWIGoYBM5M';
const uri = `spotify:playlist:${id}`;

test('shuffle follows player options and distinguishes Smart Shuffle', () => {
    let state = playbackEvent(
        {},
        {
            type: 'options_changed',
            options: { shuffle: false, modes: { context_enhancement: 'NONE' } },
        },
    );
    assert.equal(shuffleMode(state), 'off');
    state = playbackEvent(state, {
        type: 'options_changed',
        options: { shuffle: true, modes: { context_enhancement: 'NONE' } },
    });
    assert.equal(shuffleMode(state), 'on');
    state = playbackEvent(state, {
        type: 'options_changed',
        options: {
            shuffle: true,
            modes: { context_enhancement: 'RECOMMENDATION' },
        },
    });
    assert.equal(shuffleMode(state), 'smart');
    assert.equal(
        shuffleMode(
            playbackEvent(state, { type: 'auth_state', logged_in: false }),
        ),
        'unknown',
    );
    assert.throws(() =>
        playbackEvent(state, {
            type: 'options_changed',
            options: { shuffle: 'true' },
        }),
    );
    assert.equal(
        shuffleMode(state),
        'smart',
        'Invalid update must not change the previous mode.',
    );
});

test('manual shortcuts accept playlist IDs and validate names and destinations', () => {
    assert.deepEqual(playlistShortcut(' Discover Weekly ', id), {
        name: 'Discover Weekly',
        uri,
    });
    for (const name of [
        '',
        '   ',
        null,
        'x'.repeat(101),
        'name\nwith controls',
    ])
        assert.throws(() => playlistShortcut(name, id));
    assert.throws(() =>
        playlistShortcut('Weekly', 'https://example.com/playlist'),
    );
    assert.deepEqual(
        playlistShortcuts([
            ['First name', id],
            ['New name', uri],
            ['Invalid', 'spotify:track:' + id],
            [''],
            null,
        ]),
        [{ name: 'New name', uri }],
    );
    assert.deepEqual(playlistShortcuts(null), []);
});

test('playlist links and URIs normalize to playable contexts', () => {
    for (const input of [
        id,
        uri,
        `https://open.spotify.com/playlist/${id}?si=example`,
        `https://open.spotify.com/intl-en/playlist/${id}`,
    ])
        assert.equal(playlistUri(input), uri);
});

test('playlist validation rejects foreign URLs, commands, tracks, and oversized inputs', () => {
    for (const input of [
        null,
        'spotify:track:' + id,
        '-k secret',
        'https://example.com/playlist/' + id,
        'https://open.spotify.com.evil/playlist/' + id,
        'x'.repeat(2049),
    ])
        assert.throws(() => playlistUri(input));
});

test('pagination preserves valid playlists and skips deleted entries', () => {
    assert.deepEqual(
        playlistPage({ items: [null, { name: 'Weekly', uri }], next: null }),
        { items: [{ name: 'Weekly', uri }], next: null },
    );
});

test('pagination rejects links that would send bearer credentials to another host', () => {
    for (const next of [
        'http://api.spotify.com/v1/me/playlists?offset=50',
        'https://api.spotify.com.evil/v1/me/playlists?offset=50',
        'https://api.spotify.com/v1/users/other/playlists?offset=50',
    ])
        assert.throws(() => playlistPage({ items: [], next }));
});

test('tokens expire according to Spotify and retain a refresh token when omitted', () => {
    assert.deepEqual(
        tokenRecord(
            { access_token: 'new', token_type: 'Bearer', expires_in: 3600 },
            'old',
            1000,
        ),
        { access: 'new', refresh: 'old', expires: 3601000 },
    );
});

test('rotated refresh tokens replace the saved token', () => {
    assert.equal(
        tokenRecord(
            {
                access_token: 'access',
                token_type: 'Bearer',
                expires_in: 3600,
                refresh_token: 'rotated',
            },
            'old',
        ).refresh,
        'rotated',
    );
});

test('malformed tokens require reconnecting', () => {
    for (const value of [null, {}, { access: '', refresh: 'r', expires: 10 }])
        assert.throws(() => savedToken(value));
    assert.throws(() =>
        tokenRecord(
            { access_token: 'a', token_type: 'Bearer', expires_in: -1 },
            'r',
        ),
    );
});

test('Soloist playback snapshots show track, artist, and volume', () => {
    const result = playbackEvent(
        {},
        {
            type: 'playback_state',
            status: 'playing',
            volume: 65,
            is_active: true,
            item: {
                decorations: {
                    identity: { name: 'Song' },
                    creators: [
                        {
                            entity: {
                                decorations: { identity: { name: 'Artist' } },
                            },
                        },
                    ],
                },
            },
        },
    );
    assert.deepEqual(result, {
        title: 'Song',
        artist: 'Artist',
        status: 'playing',
        volume: 65,
        active: true,
        uri: '',
        duration: 0,
        position: null,
        context: '',
        shuffle: null,
        enhancement: null,
    });
});

test('pausing keeps metadata and logging out clears it', () => {
    const state = { title: 'Song', artist: 'Artist', status: 'playing' };
    const paused = playbackEvent(state, {
        type: 'playback_changed',
        status: 'paused',
    });
    assert.equal(paused.title, 'Song');
    assert.equal(paused.status, 'paused');
    assert.equal(
        playbackEvent(paused, { type: 'auth_state', logged_in: false }).title,
        '',
    );
    assert.equal(state.status, 'playing');
});

test('invalid playback updates fail without changing the prior state', () => {
    const state = { volume: 50 };
    assert.throws(() =>
        playbackEvent(state, { type: 'volume_changed', volume: 101 }),
    );
    assert.deepEqual(state, { volume: 50 });
});

test('credential import treats shell syntax as literal text', () => {
    const values = parseEnvironment(
        '# comment\nexport SPOTIFY_CLIENT_ID="example"\nSPOTIFY_SOLOIST_KEY=\'$(touch /tmp/no)\'\n',
    );
    assert.equal(values.get('SPOTIFY_CLIENT_ID'), 'example');
    assert.equal(values.get('SPOTIFY_SOLOIST_KEY'), '$(touch /tmp/no)');
    assert.throws(() => parseEnvironment('x'.repeat(65537)));
});

test('Liked Songs resolves a validated account-specific collection', () => {
    const collection = likedSongsUri({ id: 'test-user' });
    assert.equal(collection, 'spotify:user:test-user:collection');
    assert.equal(playbackUri(collection), collection);
    assert.equal(playbackUri(uri), uri);
    assert.throws(() => playlistUri(collection));
    for (const id of ['', 'user:other', 'user/other', null, 'x'.repeat(129)])
        assert.throws(() => likedSongsUri({ id }));
    for (const value of [
        'spotify:collection:tracks',
        'spotify:collection:other',
        'spotify:user:someone:collection:other',
        '',
    ])
        assert.throws(() => playbackUri(value));
});

test('device names and API keys reject invalid values before saving or launch', () => {
    assert.equal(deviceName('  Kitchen speaker  '), 'Kitchen speaker');
    for (const value of ['', 'x'.repeat(101), 'name\nother', 'name\x7f'])
        assert.throws(() => deviceName(value));
    assert.equal(soloistKey('fake-test-key'), 'fake-test-key');
    for (const value of [null, '', 'key other', 'key\0', 'x'.repeat(8193)])
        assert.throws(() => soloistKey(value));
});

test('player setup distinguishes installation, startup failure, API readiness, and pairing', () => {
    const setup = {
        installed: true,
        serviceLoaded: true,
        activeState: 'inactive',
        keySaved: true,
    };
    const playback = { connected: false, loggedIn: false };
    assert.equal(
        playerPresentation({ ...setup, installed: false }, playback)
            .installLabel,
        'Install',
    );
    assert.equal(
        playerPresentation({ ...setup, serviceLoaded: false }, playback)
            .installLabel,
        'Repair',
    );
    assert.equal(
        playerPresentation({ ...setup, keySaved: false }, playback).canToggle,
        false,
    );
    assert.equal(playerPresentation(setup, playback).toggleLabel, 'Start');
    const running = { ...setup, activeState: 'active' };
    assert.equal(playerPresentation(running, playback).toggleLabel, 'Stop');
    assert.match(
        playerPresentation(running, playback).title,
        /connection pending/,
    );
    assert.equal(
        playerPresentation(running, { ...playback, connected: true }).title,
        'Ready to pair',
    );
    assert.match(
        playerPresentation(running, { connected: true, loggedIn: true }).title,
        /Paired/,
    );
    assert.match(
        playerPresentation(
            { ...setup, activeState: 'failed', exitStatus: 10 },
            playback,
        ).detail,
        /expired/,
    );
    assert.match(
        playerPresentation(
            { ...setup, activeState: 'failed', exitStatus: 78 },
            playback,
        ).detail,
        /API key/,
    );
    assert.equal(
        playerPresentation({ ...running, keySaved: false }, playback).canToggle,
        true,
        'A locked keyring must not prevent stopping an already-running player.',
    );
});
