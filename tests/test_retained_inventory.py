"""Retained transport is mandatory in partitioned validation, without fallback."""

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class RetainedInventoryTests(unittest.TestCase):
    def test_required_inventory_and_source_materialization(self) -> None:
        manifest = json.loads((ROOT / "hygiene.json").read_bytes())
        checks = {item["id"]: item for item in manifest["checks"]}
        partitions = json.loads((ROOT / "validation-partitions.json").read_bytes())
        self.assertEqual(
            checks["retained-source"]["command"],
            ["python3", "tools/check_retained_source.py"],
        )
        self.assertEqual(
            checks["retained-snapshot-integration"]["command"],
            ["node", "--test", "test/retained-snapshot.test.js"],
        )
        self.assertIn("retained-source", partitions["partitions"]["quality"])
        self.assertIn(
            "retained-snapshot-integration", partitions["partitions"]["component"]
        )
        self.assertLess(
            partitions["partitions"]["quality"].index("retained-source"),
            partitions["partitions"]["quality"].index("static-quality"),
        )
        workflow = (ROOT / ".github/workflows/validation.yml").read_text()
        self.assertEqual(
            workflow.count("ref: 670989839a0fccbcf2014d01609778ae6e4df424"), 2
        )
        self.assertEqual(workflow.count("RUNSPINDLE_RETAINED_TETHER:"), 2)
        self.assertIn("Verify exact partition coverage and image binding", workflow)

    def test_missing_or_invalid_source_fails_visibly(self) -> None:
        for source in (None, "/missing/PRIVATE_CANARY"):
            env = dict(os.environ)
            env.pop("RUNSPINDLE_RETAINED_TETHER", None)
            if source:
                env["RUNSPINDLE_RETAINED_TETHER"] = source
            result = subprocess.run(
                [
                    sys.executable,
                    *(["-O"] if sys.flags.optimize else []),
                    "tools/check_retained_source.py",
                ],
                cwd=ROOT,
                env=env,
                capture_output=True,
                timeout=10,
            )
            self.assertEqual(result.returncode, 2)
            self.assertEqual(
                json.loads(result.stdout),
                {"status": "failed", "reason": "retained_source_rejected"},
            )
            self.assertNotIn(b"PRIVATE_CANARY", result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
