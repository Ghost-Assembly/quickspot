// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';
import { importCredentials } from '../modules/credentials.js';

const loop = new GLib.MainLoop(null, false);
let exitCode = 1;
async function main() {
    try {
        const file = Gio.File.new_for_path(ARGV[0] ?? '.env');
        await importCredentials(file);
        print('Imported Spotify credentials into GNOME Keyring.');
        exitCode = 0;
    } catch {
        printerr(
            'Credential import failed. Check the .env file and unlock GNOME Keyring.',
        );
    } finally {
        loop.quit();
    }
}
void main(); // The GLib main loop owns the asynchronous keyring operation.
loop.run();
System.exit(exitCode);
