#!/usr/bin/env python3
"""Exercise QuickSpot in an isolated GNOME session without touching user settings."""

import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UUID = "quickspot@napalm255.github.io"


def command(
    argv: list[str], environment: dict[str, str]
) -> subprocess.CompletedProcess:
    """Run a fixed GNOME test command with a bounded timeout."""
    return subprocess.run(  # noqa: S603 -- test-controlled argv
        argv, env=environment, check=True, capture_output=True, text=True, timeout=15
    )


def wait_for(log: Path, marker: str, count: int, shell: subprocess.Popen) -> None:
    """Wait for lifecycle markers while failing promptly if GNOME exits."""
    deadline = time.monotonic() + 40
    while time.monotonic() < deadline:
        text = log.read_text(errors="replace")
        if f"Extension {UUID}: Error:" in text or "JS ERROR" in text:
            raise RuntimeError("JavaScript error in isolated GNOME Shell.")
        if text.count(marker) >= count:
            return
        if shell.poll() is not None:
            raise RuntimeError("GNOME Shell exited before the lifecycle check.")
        time.sleep(0.25)
    raise RuntimeError(f"Timed out waiting for {marker}.")


def main() -> None:
    """Launch a private D-Bus, dconf database, and headless compositor."""
    with tempfile.TemporaryDirectory(prefix="quickspot-live-") as work:
        root = Path(work)
        environment = os.environ | {
            "XDG_CONFIG_HOME": str(root / "config"),
            "XDG_DATA_HOME": str(root / "data"),
            "XDG_CACHE_HOME": str(root / "cache"),
            "XDG_RUNTIME_DIR": str(root / "run"),
            "GSETTINGS_BACKEND": "dconf",
            "GI_TYPELIB_PATH": "/usr/lib64/gnome-shell/girepository-1.0",
            "LD_LIBRARY_PATH": "/usr/lib64/gnome-shell",
            "GTK_A11Y": "none",
            "GDK_BACKEND": "wayland",
            "GSK_RENDERER": "cairo",
        }
        for key in [
            "XDG_CONFIG_HOME",
            "XDG_DATA_HOME",
            "XDG_CACHE_HOME",
            "XDG_RUNTIME_DIR",
        ]:
            Path(environment[key]).mkdir(mode=0o700)
        extension = root / "data/gnome-shell/extensions" / UUID
        extension.mkdir(parents=True)
        for name in ["metadata.json", "extension.js", "prefs.js", "stylesheet.css"]:
            shutil.copy2(ROOT / name, extension / name)
        (extension / "extension.js").rename(extension / "quickspot.js")
        shutil.copy2(ROOT / "tests/shell_smoke.js", extension / "extension.js")
        for name in ["modules", "scripts", "schemas"]:
            shutil.copytree(
                ROOT / name,
                extension / name,
                ignore=shutil.ignore_patterns("__pycache__"),
            )
        command(
            ["/usr/bin/glib-compile-schemas", str(extension / "schemas")], environment
        )
        bus = subprocess.Popen(
            ["/usr/bin/dbus-daemon", "--session", "--nofork", "--print-address"],
            env=environment,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        shell = None
        log = root / "shell.log"
        try:
            if bus.stdout is None:
                raise RuntimeError("No D-Bus output.")
            environment["DBUS_SESSION_BUS_ADDRESS"] = bus.stdout.readline().strip()
            command(
                [
                    "/usr/bin/gsettings",
                    "set",
                    "org.gnome.shell",
                    "disable-user-extensions",
                    "false",
                ],
                environment,
            )
            command(
                [
                    "/usr/bin/gsettings",
                    "set",
                    "org.gnome.shell",
                    "enabled-extensions",
                    f"['{UUID}']",
                ],
                environment,
            )
            result = command(
                ["/usr/bin/gsettings", "get", "org.gnome.shell", "enabled-extensions"],
                environment,
            )
            if result.stdout.strip().splitlines()[-1] != f"['{UUID}']":
                raise RuntimeError("GNOME settings are not isolated.")
            with log.open("w") as output:
                shell = subprocess.Popen(
                    [
                        "/usr/bin/gnome-shell",
                        "--wayland",
                        "--headless",
                        "--no-x11",
                        "--virtual-monitor",
                        "1280x900",
                    ],
                    env=environment | {"G_MESSAGES_DEBUG": "all"},
                    stdout=output,
                    stderr=subprocess.STDOUT,
                )
                wait_for(log, "[quickspot] enabled", 1, shell)
                wait_for(log, "[quickspot-test] populated menu passed", 1, shell)
                wait_for(log, "[quickspot-test] top bar metadata passed", 1, shell)
                command(["/usr/bin/gnome-extensions", "disable", UUID], environment)
                wait_for(log, "[quickspot-test] teardown passed", 2, shell)
                command(["/usr/bin/gnome-extensions", "enable", UUID], environment)
                wait_for(log, "[quickspot] enabled", 2, shell)
                wait_for(log, "[quickspot-test] populated menu passed", 2, shell)
                details = command(
                    ["/usr/bin/gnome-extensions", "info", UUID], environment
                )
                if "State: ACTIVE" not in details.stdout:
                    raise RuntimeError("Extension is not active.")
                environment["WAYLAND_DISPLAY"] = next(
                    (root / "run").glob("wayland-*"), Path("wayland-0")
                ).name
                result = command(
                    [
                        "/usr/bin/gjs",
                        "-m",
                        str(ROOT / "tests/prefs_smoke.js"),
                        str(extension),
                    ],
                    environment,
                )
                print(result.stdout.strip())
                command(["/usr/bin/gnome-extensions", "disable", UUID], environment)
                wait_for(log, "[quickspot-test] teardown passed", 4, shell)
                command(["/usr/bin/gnome-extensions", "uninstall", UUID], environment)
                installed = command(["/usr/bin/gnome-extensions", "list"], environment)
                if UUID in installed.stdout or extension.exists():
                    raise RuntimeError("Uninstall did not remove QuickSpot.")
            text = log.read_text(errors="replace")
            if (
                "JS ERROR" in text
                or "had error" in text
                or f"Extension {UUID}: Error:" in text
            ):
                raise RuntimeError("JavaScript error in isolated GNOME Shell.")
            print("PASS: failed startup rolls back panel, settings, and clients")
            print("PASS: populated playlist menus survive disable and re-enable")
            print(
                "PASS: accessible artist/song label appears in the top bar and clears"
            )
            print("PASS: GNOME 50 enable, disable, re-enable, and final teardown")
            print("PASS: command-line uninstall removes QuickSpot from disk and GNOME")
        except (
            RuntimeError,
            subprocess.CalledProcessError,
            subprocess.TimeoutExpired,
        ) as error:
            if isinstance(
                error, (subprocess.CalledProcessError, subprocess.TimeoutExpired)
            ):
                print(error.stdout)
                print(error.stderr)
            text = log.read_text(errors="replace") if log.exists() else ""
            for line in text.splitlines():
                if (
                    "[quickspot" in line
                    or f"Extension {UUID}:" in line
                    or "/gnome-shell/extensions/" in line
                    or "JS ERROR" in line
                ):
                    print(line)
            raise
        finally:
            if shell is not None and shell.poll() is None:
                shell.terminate()
                shell.wait(timeout=10)
            bus.terminate()
            bus.wait(timeout=10)


if __name__ == "__main__":
    main()
