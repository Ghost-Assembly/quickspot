// SPDX-License-Identifier: GPL-3.0-or-later
// Pure boundary validation shared by GJS and the Node tests.
export function likedSongsUri(profile) {
    if (
        typeof profile?.id !== 'string' ||
        !/^[A-Za-z0-9._-]{1,128}$/.test(profile.id)
    )
        throw new Error('Spotify returned an invalid account identifier.');
    return `spotify:user:${profile.id}:collection`;
}

export function playbackUri(input) {
    if (
        typeof input === 'string' &&
        /^spotify:user:[A-Za-z0-9._-]{1,128}:collection$/.test(input)
    )
        return input;
    return playlistUri(input);
}

export function soloistKey(input) {
    if (
        typeof input !== 'string' ||
        !input ||
        input.length > 8192 ||
        /\s/u.test(input) ||
        Array.from(input).some(
            (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
        )
    )
        throw new Error('Enter a valid Soloist API key.');
    return input;
}

export function deviceName(input) {
    const value = typeof input === 'string' ? input.trim() : '';
    if (
        !value ||
        value.length > 100 ||
        Array.from(value).some(
            (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
        )
    )
        throw new Error('Enter a device name between 1 and 100 characters.');
    return value;
}

export function playerPresentation(setup, playback) {
    const running = [
        'active',
        'activating',
        'deactivating',
        'reloading',
    ].includes(setup.activeState);
    let title;
    let detail;
    if (!setup.installed) {
        title = 'Player not installed';
        detail =
            'Install the player below to use this computer as a Spotify speaker.';
    } else if (!setup.serviceLoaded) {
        title = 'Player needs setup';
        detail = 'Choose Repair to restore the player service.';
    } else if (setup.activeState === 'failed') {
        title = 'Player failed to start';
        detail =
            setup.exitStatus === 10
                ? 'This Soloist build expired. Update the player.'
                : setup.exitStatus === 78
                  ? 'Save a valid Soloist API key and device name, then try again.'
                  : 'Check your API key, network connection, and audio output, then try again.';
    } else if (!running && !setup.keySaved) {
        title = 'API key needed';
        detail = 'Save your Soloist API key below before starting the player.';
    } else if (!running) {
        title = 'Player stopped';
        detail = 'Start the player to make this computer available in Spotify.';
    } else if (!playback.connected) {
        title = 'Player running · connection pending';
        detail =
            'Waiting for the player’s local API. If this persists, restart the player.';
    } else if (!playback.loggedIn) {
        title = 'Ready to pair';
        detail =
            'Open Spotify on your phone or desktop on the same network and select this device. The web player cannot do the first pairing.';
    } else {
        title = playback.active
            ? 'Connected · this device is active'
            : 'Paired · ready to play';
        detail = playback.active
            ? `Playback: ${playback.status}`
            : 'Choose this device in Spotify or start playing from QuickSpot.';
    }
    return {
        title,
        detail: setup.error || playback.error || detail,
        running,
        toggleLabel: running ? 'Stop' : 'Start',
        canToggle:
            running ||
            Boolean(setup.installed && setup.serviceLoaded && setup.keySaved),
        installLabel: !setup.installed
            ? 'Install'
            : !setup.serviceLoaded
              ? 'Repair'
              : 'Update',
    };
}

export function playlistUri(input) {
    if (typeof input !== 'string')
        throw new Error('Enter a Spotify playlist link.');
    const value = input.trim();
    if (value.length > 2048) throw new Error('Playlist link is too long.');
    const uri = /^spotify:playlist:([A-Za-z0-9]{22})$/.exec(value);
    const parts = value.split('?')[0].split('/');
    const localized = parts.length === 6 && /^intl-[a-z-]+$/.test(parts[3]);
    const typeIndex = localized ? 4 : 3;
    // Indices come from the fixed Spotify URL shape, never from input keys.

    const candidate = parts[typeIndex + 1];
    const link =
        parts[0] === 'https:' &&
        parts[1] === '' &&
        parts[2] === 'open.spotify.com' &&
        parts.length === typeIndex + 2 &&
        // eslint-disable-next-line security/detect-object-injection
        parts[typeIndex] === 'playlist' &&
        /^[A-Za-z0-9]{22}$/.test(candidate ?? '') &&
        !/[\s#]/u.test(value);
    const id = uri?.[1] ?? (link ? candidate : null);
    if (!id) throw new Error('Use a Spotify playlist URL or URI.');
    return `spotify:playlist:${id}`;
}

export function playlistPage(value) {
    if (!value || !Array.isArray(value.items) || value.items.length > 50)
        throw new Error('Spotify returned an invalid playlist page.');
    const items = value.items
        .filter((item) => item !== null)
        .map((item) => {
            if (typeof item.name !== 'string' || item.name.length > 500)
                throw new Error('Spotify returned an invalid playlist name.');
            return { name: item.name, uri: playlistUri(item.uri) };
        });
    if (value.next !== null && typeof value.next !== 'string')
        throw new Error('Spotify returned an invalid page link.');
    if (
        value.next &&
        !/^https:\/\/api\.spotify\.com\/v1\/me\/playlists\?[^#\s]+$/.test(
            value.next,
        )
    )
        throw new Error('Spotify returned an unexpected page link.');
    return { items, next: value.next };
}

export function tokenRecord(value, previousRefresh = '', now = Date.now()) {
    if (
        !value ||
        typeof value.access_token !== 'string' ||
        !value.access_token ||
        !Number.isInteger(value.expires_in) ||
        value.expires_in <= 0 ||
        value.expires_in > 86400 ||
        value.token_type !== 'Bearer'
    )
        throw new Error('Spotify returned invalid credentials.');
    const refresh = value.refresh_token ?? previousRefresh;
    if (typeof refresh !== 'string' || !refresh)
        throw new Error('Spotify did not return a refresh token.');
    return {
        access: value.access_token,
        refresh,
        expires: now + value.expires_in * 1000,
    };
}

export function savedToken(value) {
    if (
        !value ||
        typeof value.access !== 'string' ||
        !value.access ||
        typeof value.refresh !== 'string' ||
        !value.refresh ||
        !Number.isFinite(value.expires)
    )
        throw new Error('Reconnect Spotify in QuickSpot settings.');
    return value;
}

export function entityName(item) {
    const name = item?.decorations?.identity?.name;
    return typeof name === 'string' ? name.slice(0, 500) : '';
}

export function playbackEvent(state, event) {
    if (!event || typeof event.type !== 'string')
        throw new Error('Invalid Soloist event.');
    const next = { ...state };
    if (event.type === 'auth_state') {
        if (typeof event.logged_in !== 'boolean')
            throw new Error('Invalid login state.');
        next.loggedIn = event.logged_in;
        next.active = event.is_active === true;
        if (!next.loggedIn) {
            next.status = 'idle';
            next.title = '';
            next.artist = '';
            next.uri = '';
            next.duration = 0;
            next.position = null;
            next.context = '';
        }
    }
    if (['playback_state', 'playback_changed'].includes(event.type)) {
        if (!['idle', 'playing', 'paused', 'buffering'].includes(event.status))
            throw new Error('Invalid playback state.');
        next.status = event.status;
    }
    if (['playback_state', 'track_changed'].includes(event.type)) {
        next.uri =
            typeof event.item?.uri === 'string' &&
            /^spotify:(track|episode):[A-Za-z0-9]{22}$/.test(event.item.uri)
                ? event.item.uri
                : '';
        const duration = event.item?.decorations?.playback?.duration_ms;
        next.duration =
            Number.isFinite(duration) && duration >= 0 && duration <= 86400000
                ? duration
                : 0;
        next.title = entityName(event.item);
        const creators = event.item?.decorations?.creators;
        next.artist = Array.isArray(creators)
            ? creators
                  .slice(0, 20)
                  .map((creator) => entityName(creator?.entity))
                  .filter(Boolean)
                  .join(', ')
            : '';
    }
    if (['playback_state', 'device_changed'].includes(event.type))
        next.active = event.is_active === true;
    if (['playback_state', 'volume_changed'].includes(event.type)) {
        if (
            !Number.isFinite(event.volume) ||
            event.volume < 0 ||
            event.volume > 100
        )
            throw new Error('Invalid volume.');
        next.volume = event.volume;
    }
    if (['playback_state', 'position_sync'].includes(event.type)) {
        const position = event.position;
        next.position =
            position &&
            Number.isFinite(position.position_ms) &&
            position.position_ms >= 0 &&
            Number.isFinite(position.timestamp_ms) &&
            [0, 1].includes(position.speed)
                ? { ...position }
                : null;
    }
    if (['playback_state', 'context_changed'].includes(event.type)) {
        const uri = event.context?.uri;
        next.context =
            typeof uri === 'string' &&
            /^spotify:[A-Za-z0-9:._%-]{1,512}$/.test(uri)
                ? uri
                : '';
    }
    return next;
}

export function parseEnvironment(text) {
    if (text.length > 65536) throw new Error('Credential file is too large.');
    const values = new Map();
    for (const line of text.split('\n')) {
        // eslint-disable-next-line security/detect-unsafe-regex -- credential file is bounded to 64 KiB
        const match = /^(?:export\s+)?([A-Z_][A-Z_0-9]*)\s*=\s*(.*?)\s*$/.exec(
            line.trim(),
        );
        if (!match) continue;
        let value = match[2];
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        )
            value = value.slice(1, -1);
        // Values are literal: never execute, interpolate, or source this file.
        values.set(match[1], value);
    }
    return values;
}
