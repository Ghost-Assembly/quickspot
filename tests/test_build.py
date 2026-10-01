"""Verify the actual extension ZIP contains only the allowlisted runtime files."""

import importlib.util
import shutil
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("builder", ROOT / "scripts/build.py")
if spec is None or spec.loader is None:
    raise RuntimeError("Cannot load builder.")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class BuildTests(unittest.TestCase):
    def test_bundle_contains_only_runtime_files(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            root = Path(work)
            for name in builder.RUNTIME_FILES:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ROOT / name, target)
            for name in [
                ".env",
                "README.md",
                "AGENTS.md",
                "modules/private.env",
                "scripts/soloist",
                "tests/private.js",
            ]:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("excluded fixture")

            artifact = builder.build(root)

            with zipfile.ZipFile(artifact) as bundle:
                files = {name for name in bundle.namelist() if not name.endswith("/")}
                self.assertEqual(files, set(builder.RUNTIME_FILES))
                self.assertIsNone(bundle.testzip())

    def test_invalid_schema_cannot_produce_a_bundle(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            root = Path(work)
            for name in builder.RUNTIME_FILES:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ROOT / name, target)
            schema = root / "schemas/org.gnome.shell.extensions.quickspot.gschema.xml"
            schema.write_text("<schemalist><invalid/></schemalist>")

            with self.assertRaises(subprocess.CalledProcessError):
                builder.build(root)

            self.assertEqual(list((root / "dist").iterdir()), [])


if __name__ == "__main__":
    unittest.main()
