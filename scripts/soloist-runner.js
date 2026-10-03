// SPDX-License-Identifier: GPL-3.0-or-later
// systemd runs this helper outside GNOME Shell. Secrets never enter unit files.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';
import { lookupSecret } from '../modules/secrets.js';
import { paths } from '../modules/platform.js';
import { deviceName, soloistKey } from '../modules/model.js';
import { SoloistClient } from '../modules/soloist.js';
import { MprisBridge } from '../modules/mpris.js';

const loop = new GLib.MainLoop(null, false);
let exitCode = 78;

async function main() {
    let client;
    let bridge;
    try {
        const key = soloistKey(await lookupSecret('soloist-key'));
        const source = Gio.SettingsSchemaSource.new_from_directory(
            GLib.build_filenamev([
                GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]),
                '..',
                'schemas',
            ]),
            Gio.SettingsSchemaSource.get_default(),
            false,
        );
        const settings = new Gio.Settings({
            settings_schema: source.lookup(
                'org.gnome.shell.extensions.quickspot',
                true,
            ),
        });
        const device = deviceName(settings.get_string('device-name'));
        const location = paths();
        GLib.mkdir_with_parents(location.data, 0o700);
        GLib.mkdir_with_parents(location.cache, 0o700);
        // Soloist currently requires its key as an argv option. Silence its
        // output so a diagnostic cannot copy that credential into the journal.
        const process = Gio.Subprocess.new(
            [
                location.binary,
                '--device-name',
                device,
                '--api-key',
                key,
                '--data-dir',
                location.data,
                '--cache-dir',
                location.cache,
                '--cache-size',
                '1024',
                '--ws',
                '127.0.0.1:0',
            ],
            Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE,
        );
        client = new SoloistClient(() => bridge?.sync());
        bridge = new MprisBridge(client);
        client.start();
        await new Promise((resolve, reject) => {
            process.wait_async(null, (_source, result) => {
                try {
                    process.wait_finish(result);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
        });
        exitCode = process.get_if_exited() ? process.get_exit_status() : 1;
        if (exitCode === 10)
            printerr('Soloist build expired. Update it in QuickSpot settings.');
        else if (exitCode !== 0)
            printerr('Soloist exited. Check the API key, pairing, and audio output.');
    } catch {
        printerr(
            'Soloist setup is incomplete. Install Soloist and save its API key in QuickSpot settings.',
        );
    } finally {
        bridge?.destroy();
        client?.destroy();
        loop.quit();
    }
}

void main(); // The GLib main loop keeps the helper alive until main settles.
loop.run();
System.exit(exitCode);
