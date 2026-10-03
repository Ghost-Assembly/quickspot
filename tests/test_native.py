"""Native integrations and isolated GNOME command boundary regressions."""

import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]


def load(name: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("Cannot load native test helper.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


native = load("run_native")
live = load("check_live")


class NativeTests(unittest.TestCase):
    def test_coverage_preserves_counts_and_rejects_foreign_source_paths(self) -> None:
        report = (
            "SF:/fixture/modules/player.js\nDA:7,3\nBRDA:7,0,0,2\nend_of_record\n"
            "SF:/fixture/tests/integration.js\nDA:7,50\nend_of_record\n"
        )
        measured = native.runtime_coverage(report, Path("/fixture"))
        self.assertIn("SF:modules/player.js\nDA:7,3\nBRDA:7,0,0,2", measured)
        self.assertNotIn("integration.js", measured)
        with self.assertRaises(ValueError):
            native.runtime_coverage(
                "SF:/foreign/source.js\nDA:7,3\nend_of_record", Path("/fixture")
            )
        with self.assertRaises(ValueError):
            native.runtime_coverage("no measured source", Path("/fixture"))

    def test_offline_integrations_run_with_isolated_data_and_report_runtime_coverage(self) -> None:
        native.main()
        report = (ROOT / "coverage/lcov.info").read_text()
        self.assertIn("SF:modules/spotify.js", report)
        self.assertIn("SF:modules/soloist.js", report)
        self.assertNotIn("SF:tests/", report)

    def test_only_known_commands_can_run_and_fixture_environment_is_scoped(self) -> None:
        environment = {"FIXTURE": "isolated"}
        with tempfile.TemporaryDirectory() as work, patch.object(live.subprocess, "run") as run:
            fixture = Path(work)
            for action in [
                "schemas",
                "allow-fixture",
                "select-fixture",
                "get-enabled",
                "disable",
                "enable",
                "info",
                "prefs",
                "uninstall",
                "list",
            ]:
                with self.subTest(action=action):
                    live.command(action, environment, working_directory=fixture, fixture=fixture)
                    args, options = run.call_args
                    self.assertIn(
                        args[0][0],
                        {
                            "/usr/bin/glib-compile-schemas",
                            "/usr/bin/gsettings",
                            "/usr/bin/gnome-extensions",
                            "/usr/bin/gjs",
                        },
                    )
                    self.assertTrue(options["check"])
                    self.assertEqual(options["cwd"], fixture)
                    self.assertEqual(options["env"]["QUICKSPOT_TEST_EXTENSION"], str(fixture))
            live.command("info", environment)
            self.assertEqual(run.call_args.kwargs["env"], environment)
            self.assertEqual(environment, {"FIXTURE": "isolated"})
            for action in ["unknown", "enable; touch unexpected", "/usr/bin/env"]:
                run.reset_mock()
                with self.subTest(action=action), self.assertRaises(ValueError):
                    live.command(action, environment)
                run.assert_not_called()

    def test_lifecycle_waits_reject_shell_errors_exit_and_missing_markers(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            log = Path(work) / "shell.log"
            shell = Mock()
            shell.poll.return_value = None
            with (
                patch.object(live.time, "sleep"),
                patch.object(live.time, "monotonic", return_value=0),
            ):
                log.write_text("ready ready")
                live.wait_for(log, "ready", 2, shell)
                log.write_text("JS ERROR: fixture")
                with self.assertRaisesRegex(RuntimeError, "JavaScript error"):
                    live.wait_for(log, "ready", 1, shell)
                log.write_text("not ready")
                shell.poll.return_value = 1
                with self.assertRaisesRegex(RuntimeError, "GNOME Shell exited"):
                    live.wait_for(log, "missing", 1, shell)
            shell.poll.return_value = None
            with (
                patch.object(live.time, "sleep"),
                patch.object(live.time, "monotonic", side_effect=[0, 0, 41]),
                self.assertRaisesRegex(RuntimeError, "Timed out"),
            ):
                live.wait_for(log, "missing", 1, shell)


if __name__ == "__main__":
    unittest.main()
