"""Check that unsafe Spotify archives never replace an existing installation."""

import importlib.util
import io
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "installer", Path(__file__).resolve().parents[1] / "scripts/install_soloist.py"
)
if spec is None or spec.loader is None:
    raise RuntimeError("Cannot load installer.")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class ArchiveTests(unittest.TestCase):
    def archive(self, root: Path, members: list[tuple[str, bytes]]) -> Path:
        archive = root / "archive.tar.gz"
        with tarfile.open(archive, "w:gz") as bundle:
            for name, content in members:
                member = tarfile.TarInfo(name)
                member.size = len(content)
                bundle.addfile(member, io.BytesIO(content))
        return archive

    def test_duplicate_empty_and_oversized_files_preserve_existing_binary(self) -> None:
        for members in [
            [("soloist", b"test"), ("soloist", b"duplicate")],
            [("soloist", b"")],
            [("soloist", b"a" * 12), ("CHANGELOG.md", b"b" * 12)],
        ]:
            with self.subTest(members=members), tempfile.TemporaryDirectory() as work:
                root = Path(work)
                destination = root / "installed"
                destination.mkdir()
                binary = destination / "soloist"
                binary.write_bytes(b"existing")
                archive = self.archive(root, members)

                with (
                    patch.object(installer, "MAX_SIZE", 16),
                    self.assertRaises(ValueError),
                ):
                    installer.install_archive(archive, destination)

                self.assertEqual(binary.read_bytes(), b"existing")
                self.assertEqual(list(destination.iterdir()), [binary])

    def test_invalid_version_preserves_existing_binary(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            root = Path(work)
            destination = root / "installed"
            destination.mkdir()
            binary = destination / "soloist"
            binary.write_bytes(b"existing")
            archive = self.archive(root, [("soloist", b"#!/bin/sh\nexit 0\n")])

            with self.assertRaises(ValueError):
                installer.install_archive(archive, destination)

            self.assertEqual(binary.read_bytes(), b"existing")
            self.assertEqual(list(destination.iterdir()), [binary])

    def test_successful_install_replaces_binary_and_notices(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            root = Path(work)
            destination = root / "installed"
            destination.mkdir()
            (destination / "soloist").write_bytes(b"existing")
            contents = (
                b"#!/bin/sh\n"
                b"printf 'soloist 1.2.3 build 1 (20260101) (gabc) (linux/x86_64)\\n'\n"
            )
            archive = self.archive(
                root,
                [
                    ("./soloist", contents),
                    ("THIRD_PARTY_LICENSES.txt", b"test notices"),
                ],
            )

            installer.install_archive(archive, destination)

            self.assertEqual((destination / "soloist").read_bytes(), contents)
            self.assertEqual((destination / "soloist").stat().st_mode & 0o777, 0o700)
            self.assertEqual(
                (destination / "THIRD_PARTY_LICENSES.txt").read_bytes(), b"test notices"
            )
            self.assertEqual(len(list(destination.iterdir())), 2)

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


class DownloadTests(unittest.TestCase):
    def test_redirects_stay_on_the_official_https_origin(self) -> None:
        handler = installer.SpotifyRedirectHandler()
        request = installer.urllib.request.Request(
            "https://soloist-builds.spotifycdn.com/original"
        )
        for url in [
            "http://soloist-builds.spotifycdn.com/player.tar.gz",
            "https://example.com/player.tar.gz",
            "https://soloist-builds.spotifycdn.com.evil/player.tar.gz",
            "https://soloist-builds.spotifycdn.com:8443/player.tar.gz",
            "https://user@soloist-builds.spotifycdn.com/player.tar.gz",
        ]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                handler.redirect_request(request, None, 302, "Found", {}, url)

        allowed = "https://soloist-builds.spotifycdn.com/player.tar.gz"
        redirected = handler.redirect_request(request, None, 302, "Found", {}, allowed)
        self.assertEqual(redirected.full_url, allowed)


if __name__ == "__main__":
    unittest.main()
