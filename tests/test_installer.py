"""Check that unsafe Spotify archives never replace an existing installation."""

import importlib.util
import io
import tarfile
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "installer", Path(__file__).resolve().parents[1] / "scripts/install_soloist.py"
)
if spec is None or spec.loader is None:
    raise RuntimeError("Cannot load installer.")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class ArchiveTests(unittest.TestCase):
    def test_unsafe_archives_preserve_existing_binary(self) -> None:
        for name, kind in [
            ("../soloist", tarfile.REGTYPE),
            ("/soloist", tarfile.REGTYPE),
            ("soloist", tarfile.SYMTYPE),
            ("soloist", tarfile.LNKTYPE),
            ("unrelated", tarfile.REGTYPE),
        ]:
            with (
                self.subTest(name=name, kind=kind),
                tempfile.TemporaryDirectory() as work,
            ):
                root = Path(work)
                destination = root / "installed"
                destination.mkdir()
                binary = destination / "soloist"
                binary.write_bytes(b"existing")
                archive = root / "archive.tar.gz"
                with tarfile.open(archive, "w:gz") as bundle:
                    member = tarfile.TarInfo(name)
                    member.type = kind
                    member.linkname = "/etc/passwd"
                    member.size = 4 if kind == tarfile.REGTYPE else 0
                    bundle.addfile(member, io.BytesIO(b"test"))

                with self.assertRaises(ValueError):
                    installer.install_archive(archive, destination)

                self.assertEqual(binary.read_bytes(), b"existing")
                self.assertEqual(list(destination.iterdir()), [binary])

    def test_missing_binary_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            archive = Path(work) / "empty.tar.gz"
            with tarfile.open(archive, "w:gz"):
                pass
            with self.assertRaises(ValueError):
                installer.install_archive(archive, Path(work) / "installed")


if __name__ == "__main__":
    unittest.main()
