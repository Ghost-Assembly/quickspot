import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import System from 'system';
import { playerPresentation } from '../modules/model.js';

const fixture = GLib.getenv('QUICKSPOT_TEST_EXTENSION');
if (!fixture) throw new Error('An isolated extension fixture is required.');

Gio.resources_register(
    Gio.Resource.load(
        '/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource',
    ),
);
const { default: Preferences } = await import(
    GLib.filename_to_uri(`${fixture}/prefs.js`, null)
);
const [, bytes] = Gio.File.new_for_path(`${fixture}/metadata.json`).load_contents(null);
const metadata = JSON.parse(new TextDecoder().decode(bytes));
metadata.dir = Gio.File.new_for_path(fixture);
metadata.path = fixture;
Adw.init();

function check(condition, message) {
    if (!condition) throw new Error(message);
}

function widgets(root) {
    const result = [root];
    for (let child = root.get_first_child(); child; child = child.get_next_sibling())
        result.push(...widgets(child));
    return result;
}

function row(root, title) {
    const result = widgets(root).find(
        widget => widget instanceof Adw.PreferencesRow && widget.title === title,
    );
    check(Boolean(result), `Missing settings row: ${title}`);
    return result;
}

function button(root, label) {
    const result = widgets(root).find(
        widget => widget instanceof Gtk.Button && widget.label === label,
    );
    check(Boolean(result), `Missing settings button: ${label}`);
    return result;
}

async function settled(predicate) {
    for (let count = 0; count < 100; count++) {
        if (predicate()) return;
        await new Promise(resolve =>
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
                resolve();
                return GLib.SOURCE_REMOVE;
            }),
        );
    }
    throw new Error('Preferences did not update after the action.');
}

class TestPreferences extends Preferences {
    async _lookupSecret() {
        return null;
    }

    _createSpotify() {
        return { destroy() {} };
    }

    _createPlayer(onChange) {
        const controller = {
            state: {
                installed: false,
                serviceLoaded: false,
                activeState: 'inactive',
                keySaved: false,
                autostart: false,
                checking: false,
            },
            soloist: {
                state: { connected: false, loggedIn: false, active: false },
            },
            get presentation() {
                return playerPresentation(this.state, this.soloist.state);
            },
            start: () => onChange(),
            refresh: async () => {},
            install: async () => {
                controller.state.installed = true;
                controller.state.serviceLoaded = true;
                controller.state.version = 'test';
                onChange();
            },
            control: async action => {
                if (controller.fail) throw new Error('Test service failure');
                if (action === 'start' || action === 'stop') {
                    controller.state.activeState =
                        action === 'start' ? 'active' : 'inactive';
                    controller.soloist.state.connected = false;
                } else controller.state.autostart = action === 'enable';
                onChange();
            },
            destroy: () => {
                controller.destroyed = true;
            },
            onChange,
        };
        this.player = controller;
        return controller;
    }
}

let exitCode = 0;
async function testDynamicSettings() {
    const testPrefs = new TestPreferences(metadata);
    const testWindow = new Adw.PreferencesWindow();
    try {
        testPrefs.fillPreferencesWindow(testWindow);
        testWindow.present();
        const name = row(testWindow, 'Playlist name');
        const playlist = row(testWindow, 'Playlist ID, link, or URI');
        const saved = () =>
            testPrefs.getSettings().get_value('playlist-shortcuts').deep_unpack();
        name.text = 'Discover Weekly';
        playlist.text = '37i9dQZF1DXcBWIGoYBM5M';
        button(playlist, 'Add').emit('clicked');
        check(
            !name.sensitive && !playlist.sensitive,
            'Pending operation allowed editing the inputs it will clear.',
        );
        await settled(() => name.text === '' && button(playlist, 'Add').sensitive);
        check(
            name.sensitive && playlist.sensitive,
            'Finished operation left playlist inputs disabled.',
        );
        check(
            saved().length === 1 &&
                row(testWindow, 'Discover Weekly').subtitle ===
                    'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M',
            'A playlist ID was not saved and shown without a library login.',
        );
        name.text = 'Weekly mix';
        playlist.text = 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M';
        button(playlist, 'Add').emit('clicked');
        await settled(() => name.text === '' && button(playlist, 'Add').sensitive);
        check(
            saved().length === 1 && row(testWindow, 'Weekly mix'),
            'Renaming added a duplicate shortcut.',
        );
        name.text = 'Second playlist';
        playlist.text =
            'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5N?si=example';
        button(playlist, 'Add').emit('clicked');
        await settled(() => name.text === '' && button(playlist, 'Add').sensitive);
        check(
            saved().length === 2 && row(testWindow, 'Second playlist'),
            'Multiple shortcuts were not saved.',
        );
        name.text = 'Bad destination';
        playlist.text = 'https://example.com/playlist/37i9dQZF1DXcBWIGoYBM5N';
        button(playlist, 'Add').emit('clicked');
        await settled(() => button(playlist, 'Add').sensitive);
        check(
            saved().length === 2 &&
                row(testWindow, 'QuickSpot').subtitle.includes('Spotify playlist ID'),
            'Invalid playlist input was saved or failed without feedback.',
        );
        button(row(testWindow, 'Weekly mix'), 'Remove').emit('clicked');
        await settled(() => saved().length === 1 && button(playlist, 'Add').sensitive);
        button(row(testWindow, 'Second playlist'), 'Remove').emit('clicked');
        await settled(() => saved().length === 0 && button(playlist, 'Add').sensitive);
        print(
            'PASS: manual playlist IDs, links, rename, multiple shortcuts, validation, and removal without library login',
        );
        const runtime = row(testWindow, 'Player');
        check(
            runtime.activatable_widget.label === 'Start' &&
                !runtime.activatable_widget.sensitive,
            'Start must be disabled until installation and key setup finish.',
        );
        button(testWindow, 'Install').emit('clicked');
        await settled(() => button(testWindow, 'Update').sensitive);
        check(
            !runtime.activatable_widget.sensitive,
            'Installation alone incorrectly enabled Start.',
        );
        testPrefs.player.state.keySaved = true;
        testPrefs.player.onChange();
        runtime.activatable_widget.emit('clicked');
        await settled(
            () =>
                runtime.activatable_widget.label === 'Stop' &&
                runtime.activatable_widget.sensitive,
        );
        check(
            row(testWindow, 'Player running · connection pending').visible,
            'Running service was reported as ready before API connection.',
        );
        testPrefs.player.soloist.state.connected = true;
        testPrefs.player.onChange();
        check(
            row(testWindow, 'Ready to pair').visible,
            'Unpaired player status is missing.',
        );
        const automatic = row(testWindow, 'Start at login');
        automatic.active = true;
        await settled(() => testPrefs.player.state.autostart && automatic.sensitive);
        runtime.activatable_widget.emit('clicked');
        await settled(
            () =>
                runtime.activatable_widget.label === 'Start' &&
                runtime.activatable_widget.sensitive,
        );
        testPrefs.player.fail = true;
        runtime.activatable_widget.emit('clicked');
        await settled(() => runtime.activatable_widget.sensitive);
        check(
            row(testWindow, 'QuickSpot').subtitle === 'Test service failure',
            'Service failure was hidden.',
        );
        automatic.active = false;
        await settled(() => automatic.sensitive);
        check(
            automatic.active && testPrefs.player.state.autostart,
            'Failed autostart change left the switch out of sync with the service.',
        );
        testWindow.close();
        check(
            testPrefs.player.destroyed,
            'Closing preferences retained player monitoring.',
        );
        print(
            'PASS: native dynamic installation, Start/Stop, pairing, autostart, failure, and close controls',
        );
    } catch (error) {
        printerr(error.stack);
        exitCode = 1;
    } finally {
        testWindow.close();
    }
}
await testDynamicSettings();
System.exit(exitCode);
