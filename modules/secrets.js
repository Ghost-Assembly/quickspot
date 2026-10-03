// SPDX-License-Identifier: GPL-3.0-or-later
import Secret from 'gi://Secret';

function schema() {
    return Secret.Schema.new('org.ghostassembly.QuickSpot', Secret.SchemaFlags.NONE, {
        kind: Secret.SchemaAttributeType.STRING,
    });
}

export function lookupSecret(kind, cancellable = null) {
    return new Promise((resolve, reject) => {
        Secret.password_lookup(schema(), { kind }, cancellable, (_source, result) => {
            try {
                resolve(Secret.password_lookup_finish(result));
            } catch {
                reject(
                    new Error('Unlock GNOME Keyring to access QuickSpot credentials.'),
                );
            }
        });
    });
}

export function storeSecret(kind, value, cancellable = null) {
    return new Promise((resolve, reject) => {
        Secret.password_store(
            schema(),
            { kind },
            Secret.COLLECTION_DEFAULT,
            `QuickSpot: ${kind}`,
            value,
            cancellable,
            (_source, result) => {
                try {
                    if (!Secret.password_store_finish(result))
                        throw new Error('Store failed.');
                    resolve();
                } catch {
                    reject(new Error('Could not save credentials to GNOME Keyring.'));
                }
            },
        );
    });
}

export function clearSecret(kind, cancellable = null) {
    return new Promise((resolve, reject) => {
        Secret.password_clear(schema(), { kind }, cancellable, (_source, result) => {
            try {
                Secret.password_clear_finish(result);
                resolve();
            } catch {
                reject(new Error('Could not remove QuickSpot credentials.'));
            }
        });
    });
}
