// SPDX-License-Identifier: GPL-3.0-or-later
import { parseEnvironment, soloistKey } from './model.js';
import { readText } from './platform.js';
import { storeSecret } from './secrets.js';

export async function importCredentials(
    file,
    cancellable = null,
    save = storeSecret,
) {
    const values = parseEnvironment(await readText(file, 65536, cancellable));
    const id = values.get('SPOTIFY_CLIENT_ID');
    const key = values.get('SPOTIFY_SOLOIST_KEY');
    if (!id && !key)
        throw new Error(
            'The file needs a Spotify client ID or Soloist API key.',
        );
    if (id && !/^[a-fA-F0-9]{32}$/.test(id))
        throw new Error('The file contains an invalid Spotify client ID.');
    if (key) soloistKey(key);
    // Validate both values before storing either one.
    if (id) await save('client-id', id, cancellable);
    if (key) await save('soloist-key', key, cancellable);
    return { clientId: id ?? '', keySaved: Boolean(key) };
}
