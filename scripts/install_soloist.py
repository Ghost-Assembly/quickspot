#!/usr/bin/env python3
"""Install Spotify's official Soloist build in the user's data directory."""

import argparse
import http.client
import os
import platform
import re
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

ARCHITECTURES = {"x86_64": "x86_64", "aarch64": "arm64", "armv7l": "arm32"}
MAX_SIZE = 128 * 1024 * 1024
FILES = {"soloist", "THIRD_PARTY_LICENSES.txt", "CHANGELOG.md"}


class SpotifyRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Keep redirected downloads on Spotify's official HTTPS origin."""

    def redirect_request(
        self,
        req: urllib.request.Request,
        fp: http.client.HTTPResponse | None,
        code: int,
        msg: str,
        headers: http.client.HTTPMessage | dict[str, str],
        newurl: str,
    ) -> urllib.request.Request | None:
        destination = urlsplit(newurl)
        if (
            destination.scheme != "https"
            or destination.hostname != "soloist-builds.spotifycdn.com"
            or destination.port not in (None, 443)
            or destination.username is not None
            or destination.password is not None
        ):
            raise ValueError("Unexpected Spotify download redirect.")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def install_archive(archive: Path, destination: Path) -> None:
    """Validate the archive and stage regular files before replacing the binary."""
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.TemporaryDirectory(dir=destination, prefix=".install-") as work:
        staging = Path(work)
        with tarfile.open(archive, "r:gz") as bundle:
            seen = set()
            total_size = 0
            for member in bundle:
                name = member.name.removeprefix("./")
                if name not in FILES or name in seen or not member.isfile():
                    raise ValueError("Unexpected file in Spotify archive.")
                total_size += member.size
                if total_size > MAX_SIZE or member.size <= 0:
                    raise ValueError("Invalid file size in Spotify archive.")
                seen.add(name)
                source = bundle.extractfile(member)
                if source is None:
                    raise ValueError("Cannot read Spotify archive.")
                with source, (staging / name).open("xb") as target:
                    shutil.copyfileobj(source, target)
            if "soloist" not in seen:
                raise ValueError("Spotify archive does not contain Soloist.")
        binary = staging / "soloist"
        binary.chmod(0o700)
        # Only the allowlisted binary from Spotify's official HTTPS archive runs.
        result = subprocess.run(  # noqa: S603
            [str(binary), "--version"], check=True, capture_output=True, timeout=10
        )
        if not re.match(
            rb"soloist [A-Za-z0-9][A-Za-z0-9.+-]{0,127}(?:\s|$)", result.stdout.strip()
        ):
            raise ValueError("Downloaded player did not report a Soloist version.")
        for name in sorted(seen - {"soloist"}):
            os.replace(staging / name, destination / name)
        os.replace(binary, destination / "soloist")


def main() -> None:
    """Download a bounded archive and install it without root privileges."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", type=Path)
    args = parser.parse_args()
    architecture = ARCHITECTURES.get(platform.machine())
    if architecture is None:
        parser.error("Spotify Soloist has no official build for this CPU.")
    destination = args.destination or (
        Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share"))
        / "quickspot"
    )
    url = f"https://soloist-builds.spotifycdn.com/soloist_release_{architecture}.tar.gz"
    opener = urllib.request.build_opener(SpotifyRedirectHandler())
    with tempfile.TemporaryDirectory(prefix="quickspot-download-") as work:
        archive = Path(work) / "soloist.tar.gz"
        # The URL is constructed from a fixed HTTPS origin and CPU allowlist.
        with (
            opener.open(url, timeout=30) as response,
            archive.open("xb") as out,
        ):
            size = 0
            while chunk := response.read(65536):
                size += len(chunk)
                if size > MAX_SIZE:
                    raise ValueError("Spotify archive exceeds the size limit.")
                out.write(chunk)
        install_archive(archive, destination)
    print("Installed Spotify Soloist from Spotify's official download server.")


if __name__ == "__main__":
    main()
