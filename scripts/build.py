#!/usr/bin/env python3
"""Build a QuickSpot extension bundle from an explicit runtime allowlist."""

import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNTIME_FILES = [
    "metadata.json",
    "extension.js",
    "prefs.js",
    "stylesheet.css",
    "LICENSE",
    "schemas/org.gnome.shell.extensions.quickspot.gschema.xml",
    "modules/model.js",
    "modules/mpris.js",
    "modules/platform.js",
    "modules/player.js",
    "modules/credentials.js",
    "modules/secrets.js",
    "modules/soloist.js",
    "modules/spotify.js",
    "scripts/install_soloist.py",
    "scripts/soloist-runner.js",
]


def main() -> None:
    """Stage runtime files only; GNOME builds and validates the schema."""
    output = ROOT / "dist"
    output.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="quickspot-build-") as work:
        staging = Path(work)
        for name in RUNTIME_FILES:
            target = staging / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / name, target)
        subprocess.run(  # noqa: S603 -- fixed executable and allowlisted sources
            [
                "/usr/bin/gnome-extensions",
                "pack",
                "--force",
                f"--out-dir={output}",
                "--extra-source=modules",
                "--extra-source=scripts",
                "--extra-source=LICENSE",
                str(staging),
            ],
            check=True,
        )
    print("Built dist/quickspot@napalm255.github.io.shell-extension.zip")


if __name__ == "__main__":
    main()
