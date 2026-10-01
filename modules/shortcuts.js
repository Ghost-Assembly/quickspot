// SPDX-License-Identifier: GPL-3.0-or-later
import GLib from 'gi://GLib';
import { playlistShortcuts } from './model.js';

export function readShortcuts(settings) {
    return playlistShortcuts(
        settings.get_value('playlist-shortcuts').deep_unpack(),
    );
}

export function writeShortcuts(settings, playlists) {
    const saved = settings.set_value(
        'playlist-shortcuts',
        new GLib.Variant(
            'aas',
            playlists.map(({ name, uri }) => [name, uri]),
        ),
    );
    if (!saved) throw new Error('Could not save playlist shortcuts.');
}
