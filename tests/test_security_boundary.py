"""Keep private credentials out of scanner staging and propagate scanner failures."""

import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "security_source", ROOT / "scripts/security_source.py"
)
if spec is None or spec.loader is None:
    raise RuntimeError("Cannot load source scanner.")
security = importlib.util.module_from_spec(spec)
spec.loader.exec_module(security)


class SecurityBoundaryTests(unittest.TestCase):
    def test_private_files_are_never_staged_and_scanner_failures_stop_the_pipeline(self) -> None:
        original_run = subprocess.run

        def make_scanner(failing_scanner, scanned, staging_paths):
            def scanner(argv, **options):
                if argv[1] == "git":
                    return original_run(argv, **options)
                staging = options["cwd"]
                staging_paths.append(staging)
                scanned.append(argv[1])
                self.assertFalse((staging / ".env").exists())
                self.assertEqual(
                    (staging / "extension.js").read_text(), "export const fixture = true;\n"
                )
                self.assertTrue(options["check"])
                if argv[1] == failing_scanner:
                    raise subprocess.CalledProcessError(1, argv)
                return subprocess.CompletedProcess(argv, 0)

            return scanner

        for failing_scanner in [None, "gitleaks", "trivy"]:
            with self.subTest(scanner=failing_scanner), tempfile.TemporaryDirectory() as work:
                root = Path(work)
                original_run(["/usr/bin/env", "git", "init", "--quiet"], cwd=root, check=True)
                (root / ".gitignore").write_text(".env\n")
                (root / ".env").write_text("private fixture content")
                (root / "extension.js").write_text("export const fixture = true;\n")
                scanned = []
                staging_paths = []

                with (
                    patch("sys.argv", ["security_source.py", str(root)]),
                    patch.object(
                        security.subprocess,
                        "run",
                        side_effect=make_scanner(failing_scanner, scanned, staging_paths),
                    ),
                ):
                    if failing_scanner is None:
                        security.main()
                    else:
                        with self.assertRaises(subprocess.CalledProcessError):
                            security.main()

                expected = ["gitleaks"] if failing_scanner == "gitleaks" else ["gitleaks", "trivy"]
                self.assertEqual(scanned, expected)
                self.assertTrue(all(not staging.exists() for staging in staging_paths))
                self.assertEqual((root / ".env").read_text(), "private fixture content")


if __name__ == "__main__":
    unittest.main()
