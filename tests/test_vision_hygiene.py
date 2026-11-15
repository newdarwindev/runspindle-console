"""Keep artifact integrity and SRC-010 checks explicit in hygiene execution."""

import io
import json
import runpy
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from tools import hygiene

ROOT = Path(__file__).resolve().parents[1]


class VisionHygieneTests(unittest.TestCase):
    def test_artifact_and_vision_checks_are_assigned_once(self) -> None:
        manifest = json.loads((ROOT / "hygiene.json").read_text())
        partitions = json.loads((ROOT / "validation-partitions.json").read_text())
        coverage = [
            item for assigned in partitions["partitions"].values() for item in assigned
        ]
        for check_id, checker in (
            ("check-artifacts", "tools/check_artifacts.py"),
            ("check-vision", "tools/check_vision.py"),
        ):
            entries = [x for x in manifest["checks"] if x["id"] == check_id]
            self.assertEqual(len(entries), 1)
            self.assertEqual(entries[0]["command"], ["python3", checker])
            self.assertIn(checker, entries[0]["required_files"])
            self.assertNotIn("not_applicable", entries[0])
            self.assertEqual(coverage.count(check_id), 1)
            self.assertIn(check_id, partitions["partitions"]["component"])

    def test_scaffold_never_runs_nested_artifact_checker(self) -> None:
        with (
            patch(
                "subprocess.run", side_effect=AssertionError("nested checker")
            ) as run,
            redirect_stdout(io.StringIO()) as output,
        ):
            runpy.run_path(str(ROOT / "tools/check_scaffold.py"), run_name="__main__")
        run.assert_not_called()
        self.assertEqual(json.loads(output.getvalue())["status"], "passed")

    def test_missing_vision_checker_is_failure_not_skip(self) -> None:
        manifest = json.loads((ROOT / "hygiene.json").read_text())
        entry = next(x for x in manifest["checks"] if x["id"] == "check-vision")
        with tempfile.TemporaryDirectory() as directory:
            result = hygiene.run_entry(Path(directory), entry)
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["reason"], "required_file_missing")


if __name__ == "__main__":
    unittest.main()
