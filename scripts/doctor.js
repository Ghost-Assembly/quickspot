// SPDX-License-Identifier: GPL-3.0-or-later
// A private diagnostic: never print tokens, account names, or track metadata.
import GLib from 'gi://GLib';
import System from 'system';
import { PlayerController } from '../modules/player.js';

const loop = new GLib.MainLoop(null, false);
const player = new PlayerController(() => {});
let exitCode = 1;
let timer = 0;
let expired = false;

async function diagnose() {
    try {
        player.start();
        await player.refresh();
        await player.refreshCredentials();
        if (expired) return;
        await new Promise((resolve) => {
            timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 4, () => {
                timer = 0;
                resolve();
                return GLib.SOURCE_REMOVE;
            });
        });
        print(
            `Installed: ${player.state.installed ? `Soloist ${player.state.version}` : 'no'}`,
        );
        print(
            `Service: ${player.state.serviceLoaded ? player.state.activeState : 'not installed'}`,
        );
        print(`Start at login: ${player.state.autostart ? 'yes' : 'no'}`);
        print(
            `API key saved: ${player.state.keySaved ? 'yes' : 'no or keyring locked'}`,
        );
        print(
            `Local API: ${player.soloist.state.connected ? 'connected' : 'unavailable'}`,
        );
        print(
            `Speaker paired: ${player.soloist.state.loggedIn ? 'yes' : 'no'}`,
        );
        print(player.presentation.title);
        print(player.presentation.detail);
        exitCode = player.soloist.state.connected ? 0 : 1;
    } catch (_error) {
        printerr('Could not finish the player diagnostic.');
    } finally {
        player.destroy();
        loop.quit();
    }
}

const deadline = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 12, () => {
    expired = true;
    if (timer) GLib.Source.remove(timer);
    timer = 0;
    player.destroy();
    printerr(
        'Diagnostic timed out. Unlock GNOME Keyring and check the session service manager.',
    );
    loop.quit();
    return GLib.SOURCE_REMOVE;
});
void diagnose(); // The GLib loop owns the diagnostic lifetime.
loop.run();
if (!expired) GLib.Source.remove(deadline);
System.exit(exitCode);
