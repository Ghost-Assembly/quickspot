#!/usr/bin/env python3
"""Run offline GJS integration tests with isolated data and cache directories."""

import os
import subprocess
import tempfile
from pathlib import Path


def main() -> None:
    """Set XDG paths before GJS starts, since GLib caches them on first access."""
    with tempfile.TemporaryDirectory(prefix="quickspot-native-") as work:
        environment = os.environ | {
            "QUICKSPOT_TEST_HOME": work,
            "XDG_DATA_HOME": work,
            "XDG_CACHE_HOME": str(Path(work) / "cache"),
            "XDG_CONFIG_HOME": str(Path(work) / "config"),
            "GIO_USE_VFS": "local",
        }
        subprocess.run(  # noqa: S603 -- fixed test executable and source
            [
                "/usr/bin/dbus-run-session",
                "--",
                "/usr/bin/gjs",
                "-m",
                str(Path(__file__).resolve().parents[1] / "tests/gnome-integration.js"),
            ],
            env=environment,
            check=True,
            timeout=30,
        )


if __name__ == "__main__":
    main()
