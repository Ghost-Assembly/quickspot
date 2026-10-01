#!/usr/bin/env python3
"""Build a QuickSpot extension bundle from an explicit runtime allowlist."""

import argparse
import json
import shutil
import subprocess
import tempfile
import zipfile
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
    """Validate schemas and package allowlisted files at the archive root."""
    metadata = json.loads((root / "metadata.json").read_text())
    artifact = root / f"{metadata['uuid']}.shell-extension.zip"
    with tempfile.TemporaryDirectory(prefix="quickspot-build-", dir=root) as work:
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
        staged_zip = staging / artifact.name
        with zipfile.ZipFile(staged_zip, "w", zipfile.ZIP_DEFLATED) as bundle:
            for name in RUNTIME_FILES:
                bundle.write(staging / name, name)
        staged_zip.replace(artifact)
    return artifact


def check(root: Path = ROOT) -> None:
    """Compare runtime contents with GNOME's official packer."""
    metadata = json.loads((root / "metadata.json").read_text())
    artifact = root / f"{metadata['uuid']}.shell-extension.zip"
    with tempfile.TemporaryDirectory(prefix="quickspot-pack-check-") as work:
        staging = Path(work) / "source"
        staging.mkdir()
        for name in RUNTIME_FILES:
            target = staging / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(root / name, target)
        subprocess.run(  # noqa: S603 -- fixed executable and allowlisted sources
            [
                "/usr/bin/gnome-extensions",
                "pack",
                "--force",
                f"--out-dir={work}",
                "--extra-source=modules",
                "--extra-source=scripts",
                "--extra-source=LICENSE",
                str(staging),
            ],
            check=True,
        )
        with (
            zipfile.ZipFile(artifact) as actual,
            zipfile.ZipFile(Path(work) / artifact.name) as official,
        ):
            actual_files = {n for n in actual.namelist() if not n.endswith("/")}
            official_files = {n for n in official.namelist() if not n.endswith("/")}
            if actual_files != official_files or any(
                actual.read(name) != official.read(name) for name in actual_files
            ):
                raise RuntimeError("Bundle differs from GNOME's official packer.")
    print("PASS: runtime files and contents match GNOME's official packer")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Compare the built ZIP")
    args = parser.parse_args()
    if args.check:
        check()
    else:
        print(f"Built {build().relative_to(ROOT)}")
