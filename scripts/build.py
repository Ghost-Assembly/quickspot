#!/usr/bin/env python3
"""Build a QuickSpot extension bundle from an explicit runtime allowlist."""

import json
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
    "modules/shortcuts.js",
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


def build(root: Path = ROOT) -> Path:
    """Validate schemas and package only the staged runtime files."""
    output = root / "dist"
    output.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="quickspot-build-") as work:
        staging = Path(work)
        for name in RUNTIME_FILES:
            target = staging / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(root / name, target)
        subprocess.run(  # noqa: S603 -- fixed executable and staging directory
            [
                "/usr/bin/glib-compile-schemas",
                "--strict",
                "--dry-run",
                str(staging / "schemas"),
            ],
            check=True,
        )
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
    metadata = json.loads((root / "metadata.json").read_text())
    return output / f"{metadata['uuid']}.shell-extension.zip"


if __name__ == "__main__":
    print(f"Built {build().relative_to(ROOT)}")
