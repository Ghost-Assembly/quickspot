// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {
    paths,
    run,
    service,
    serviceStatus,
    writeService,
} from './platform.js';
import { lookupSecret } from './secrets.js';
import { SoloistClient } from './soloist.js';
import { playerPresentation, soloistKey } from './model.js';

// Shared by preferences and the panel: systemd state and playback are distinct.
export class PlayerController {
    constructor(
        onChange,
        {
            probe = serviceStatus,
            lookup = lookupSecret,
            command = run,
            control = service,
            writeUnit = writeService,
        } = {},
    ) {
        this._onChange = onChange;
        this._probe = probe;
        this._lookup = lookup;
        this._command = command;
        this._control = control;
        this._writeUnit = writeUnit;
        this._credentialError = '';
        this._cancel = new Gio.Cancellable();
        this._timer = 0;
        this._refresh = null;
        this._binaryStamp = null;
        this.state = {
            installed: false,
            version: '',
            serviceLoaded: false,
            activeState: 'unknown',
            autostart: false,
            keySaved: false,
            keyChecked: false,
            error: '',
            checking: true,
        };
        this.soloist = new SoloistClient(() => this._changed());
    }

    get presentation() {
        return playerPresentation(this.state, this.soloist.state);
    }

    _changed() {
        if (!this._cancel.is_cancelled()) this._onChange?.();
    }

    start() {
        if (this._timer || this._cancel.is_cancelled()) return;
        this.soloist.start();
        void this.refresh(); // refresh catches probe errors and exposes them in state.
        void this.refreshCredentials();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3, () => {
            void this.refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    async refreshCredentials() {
        try {
            const key = await this._lookup('soloist-key', this._cancel);
            if (this._cancel.is_cancelled()) return;
            this.state.keySaved = false;
            this._credentialError = '';
            if (key) {
                try {
                    this.state.keySaved = Boolean(soloistKey(key));
                } catch (_error) {
                    this._credentialError =
                        'The saved API key is invalid. Save a valid Soloist key.';
                }
            }
        } catch (_error) {
            if (!this._cancel.is_cancelled()) {
                this.state.keySaved = false;
                this._credentialError =
                    'Unlock GNOME Keyring to check your saved API key.';
            }
        }
        if (!this._cancel.is_cancelled()) {
            this.state.keyChecked = true;
            this.state.error = this._credentialError;
        }
        this._changed();
    }

    async refresh() {
        if (this._cancel.is_cancelled()) return;
        if (this._refresh) return this._refresh;
        this._refresh = this._readState();
        try {
            await this._refresh;
        } finally {
            this._refresh = null;
        }
    }

    async _readState() {
        try {
            const binary = Gio.File.new_for_path(paths().binary);
            let installed = false;
            let stamp = '';
            try {
                const info = binary.query_info(
                    'standard::type,standard::size,time::modified,access::can-execute',
                    Gio.FileQueryInfoFlags.NONE,
                    this._cancel,
                );
                installed =
                    info.get_file_type() === Gio.FileType.REGULAR &&
                    info.get_attribute_boolean('access::can-execute');
                stamp = `${info.get_attribute_uint64('time::modified')}:${info.get_size()}`;
            } catch (error) {
                if (
                    !error.matches(
                        Gio.io_error_quark(),
                        Gio.IOErrorEnum.NOT_FOUND,
                    )
                )
                    throw error;
            }
            let version = this.state.version;
            if (installed && stamp !== this._binaryStamp) {
                const output = await this._command(
                    [paths().binary, '--version'],
                    this._cancel,
                    5,
                );
                version = /^soloist ([a-zA-Z0-9.]+)\b/.exec(output)?.[1] ?? '';
                if (!version)
                    throw new Error(
                        'The installed player did not report a valid version. Reinstall it.',
                    );
                this._binaryStamp = stamp;
            }
            const status = await this._probe(this._cancel);
            if (this._cancel.is_cancelled()) return;
            this.state = {
                ...this.state,
                ...status,
                installed,
                version: installed ? version : '',
                error: this._credentialError,
                checking: false,
            };
        } catch (_error) {
            if (this._cancel.is_cancelled()) return;
            this.state.error =
                'Could not check the player. Check the session service manager and player installation.';
            this.state.checking = false;
        }
        this._changed();
    }

    async control(action) {
        await this._control(action, this._cancel);
        await this.refresh();
    }

    async install(extensionPath) {
        await this.refresh();
        const resume = this.presentation.running;
        if (this.state.serviceLoaded) await this.control('stop');
        let failure = null;
        try {
            await this._command(
                ['python3', `${extensionPath}/scripts/install_soloist.py`],
                this._cancel,
                180,
            );
            this._writeUnit(extensionPath);
            await this._command(
                ['/usr/bin/systemctl', '--user', 'daemon-reload'],
                this._cancel,
            );
        } catch (error) {
            failure = error;
        } finally {
            // Closing preferences cancels the download, but restores prior playback.
            if (resume) {
                try {
                    await this._control('start', null);
                } catch (_error) {
                    failure = new Error(
                        'The update failed to restore the running player. Start it again from settings.',
                    );
                }
            }
            await this.refresh();
        }
        if (failure) throw failure;
    }

    async repair(extensionPath) {
        this._writeUnit(extensionPath);
        await this._command(
            ['/usr/bin/systemctl', '--user', 'daemon-reload'],
            this._cancel,
        );
        await this.refresh();
    }

    destroy() {
        this._onChange = null;
        this._cancel.cancel();
        if (this._timer) GLib.Source.remove(this._timer);
        this._timer = 0;
        this.soloist.destroy();
    }
}
