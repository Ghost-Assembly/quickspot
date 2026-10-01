// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export function paths() {
    const root = GLib.build_filenamev([GLib.get_user_data_dir(), 'quickspot']);
    return {
        root,
        binary: GLib.build_filenamev([root, 'soloist']),
        data: GLib.build_filenamev([root, 'player']),
        cache: GLib.build_filenamev([GLib.get_user_cache_dir(), 'quickspot']),
    };
}

export function runResult(argv, cancellable = null, timeout = 30) {
    const process = Gio.Subprocess.new(
        argv,
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
    );
    return new Promise((resolve, reject) => {
        let expired = false;
        const timer = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            timeout,
            () => {
                expired = true;
                process.force_exit();
                return GLib.SOURCE_REMOVE;
            },
        );
        process.communicate_utf8_async(
            null,
            cancellable,
            (_process, result) => {
                try {
                    const [, output] = process.communicate_utf8_finish(result);
                    if (expired) throw new Error('Command timed out.');
                    resolve({
                        status: process.get_if_exited()
                            ? process.get_exit_status()
                            : -1,
                        output: output.trim(),
                    });
                } catch (_error) {
                    if (cancellable?.is_cancelled()) process.force_exit();
                    reject(
                        new Error(
                            expired
                                ? 'The operation timed out. Try again.'
                                : 'The operation was canceled or could not finish.',
                        ),
                    );
                } finally {
                    if (!expired) GLib.Source.remove(timer);
                }
            },
        );
    });
}

export async function run(argv, cancellable = null, timeout = 30) {
    const result = await runResult(argv, cancellable, timeout);
    if (result.status !== 0)
        throw new Error(
            'The operation failed. Check the player status in QuickSpot settings.',
        );
    return result.output;
}

export async function serviceStatus(cancellable = null) {
    const result = await runResult(
        [
            '/usr/bin/systemctl',
            '--user',
            'show',
            'quickspot-soloist.service',
            '--property=LoadState,ActiveState,SubState,Result,ExecMainStatus,UnitFileState',
        ],
        cancellable,
        5,
    );
    const values = new Map(
        result.output.split('\n').map((line) => {
            const index = line.indexOf('=');
            return [line.slice(0, index), line.slice(index + 1)];
        }),
    );
    if (!values.has('LoadState'))
        throw new Error('Cannot reach your session’s service manager.');
    return {
        serviceLoaded: values.get('LoadState') === 'loaded',
        activeState: values.get('ActiveState') ?? 'unknown',
        subState: values.get('SubState') ?? '',
        exitStatus: Number(values.get('ExecMainStatus') ?? 0),
        result: values.get('Result') ?? '',
        autostart: ['enabled', 'enabled-runtime'].includes(
            values.get('UnitFileState'),
        ),
    };
}

// Bounded reads prevent oversized or special credential files from blocking UI.
export async function readText(file, limit, cancellable = null) {
    const info = await new Promise((resolve, reject) => {
        file.query_info_async(
            'standard::size,standard::type',
            Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT,
            cancellable,
            (source, result) => {
                try {
                    resolve(source.query_info_finish(result));
                } catch (error) {
                    reject(error);
                }
            },
        );
    });
    if (
        info.get_file_type() !== Gio.FileType.REGULAR ||
        info.get_size() > limit
    )
        throw new Error(
            'Choose a regular credential file no larger than 64 KiB.',
        );
    const stream = await new Promise((resolve, reject) => {
        file.read_async(
            GLib.PRIORITY_DEFAULT,
            cancellable,
            (source, result) => {
                try {
                    resolve(source.read_finish(result));
                } catch (error) {
                    reject(error);
                }
            },
        );
    });
    try {
        const chunks = [];
        let size = 0;
        while (size <= limit) {
            const chunk = await new Promise((resolve, reject) => {
                stream.read_bytes_async(
                    Math.min(16384, limit + 1 - size),
                    GLib.PRIORITY_DEFAULT,
                    cancellable,
                    (source, result) => {
                        try {
                            resolve(
                                source.read_bytes_finish(result).get_data(),
                            );
                        } catch (error) {
                            reject(error);
                        }
                    },
                );
            });
            if (!chunk.length) break;
            size += chunk.length;
            chunks.push(chunk);
        }
        if (size > limit) throw new Error('Credential file is too large.');
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
        }
        return new TextDecoder().decode(bytes);
    } finally {
        stream.close(null);
    }
}

export function service(action, cancellable = null) {
    if (
        ![
            'start',
            'stop',
            'restart',
            'enable',
            'disable',
            'is-active',
        ].includes(action)
    )
        throw new Error('Invalid service action.');
    return run(
        ['/usr/bin/systemctl', '--user', action, 'quickspot-soloist.service'],
        cancellable,
    );
}

export function writeService(extensionPath) {
    if (
        !GLib.path_is_absolute(extensionPath) ||
        Array.from(extensionPath).some(
            (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
        )
    )
        throw new Error(
            'The extension path cannot be used in a service definition.',
        );
    const directory = GLib.build_filenamev([
        GLib.get_user_config_dir(),
        'systemd',
        'user',
    ]);
    const target = GLib.build_filenamev([
        directory,
        'quickspot-soloist.service',
    ]);
    const runner = `${extensionPath}/scripts/soloist-runner.js`;
    // systemd expands percent specifiers even inside quotes.
    const escaped = runner
        .replaceAll('\\', '\\\\')
        .replaceAll('"', '\\"')
        .replaceAll('%', '%%');
    const unit = `[Unit]\nDescription=QuickSpot Spotify Soloist\nPartOf=graphical-session.target\n\n[Service]\nExecStart=/usr/bin/gjs -m "${escaped}"\nRestart=on-failure\nRestartSec=5\nRestartPreventExitStatus=10 78\nUMask=0077\n\n[Install]\nWantedBy=graphical-session.target\n`;
    GLib.mkdir_with_parents(directory, 0o700);
    Gio.File.new_for_path(target).replace_contents(
        unit,
        null,
        false,
        Gio.FileCreateFlags.PRIVATE,
        null,
    );
}
