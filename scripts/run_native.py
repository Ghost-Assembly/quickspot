#!/usr/bin/env python3
"""Run offline GJS integration tests with isolated data and cache directories."""

import os
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def runtime_coverage(report: str, source_root: Path) -> str:
    """Map GJS source copies to runtime paths without changing measured counts."""
    records = []
    for record in report.split("end_of_record"):
        lines = record.splitlines()
        source = next((line for line in lines if line.startswith("SF:")), None)
        if source is None:
            continue
        path = Path(source[3:]).relative_to(source_root)
        if path.parts[0] != "modules":
            continue
        records.append(
            "\n".join("SF:" + path.as_posix() if line == source else line for line in lines)
        )
    if not records:
        raise ValueError("Native integration coverage contains no runtime source.")
    return "\nend_of_record\n".join(records) + "\nend_of_record\n"


def main() -> None:
    """Set XDG paths before GJS starts, since GLib caches them on first access."""
    with tempfile.TemporaryDirectory(prefix="quickspot-native-") as work:
        coverage = ROOT / "coverage/native"
        environment = os.environ | {
            "QUICKSPOT_TEST_HOME": work,
            "XDG_DATA_HOME": work,
            "XDG_CACHE_HOME": str(Path(work) / "cache"),
            "XDG_CONFIG_HOME": str(Path(work) / "config"),
            "GIO_USE_VFS": "local",
        }
        subprocess.run(
            [
                "/usr/bin/dbus-run-session",
                "--",
                "/usr/bin/gjs",
                "--coverage-prefix=file://",
                "--coverage-output=coverage/native",
                "-m",
                "tests/gnome-integration.js",
            ],
            env=environment,
            cwd=ROOT,
            check=True,
            timeout=30,
        )
        # GJS copies measured source below its output directory. Normalize only
        # those source paths; preserve every execution and branch count.
        source_root = coverage
        report = (coverage / "coverage.lcov").read_text()
        measured = runtime_coverage(report, source_root)
        destination = ROOT / "coverage/lcov.info"
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("a") as output:
            output.write(measured)


if __name__ == "__main__":
    main()
