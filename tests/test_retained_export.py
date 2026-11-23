"""Process-level pinned-source and read-only exporter boundaries."""

import json
import os
import py_compile
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class RetainedExportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.source = os.environ.get("RUNSPINDLE_RETAINED_TETHER", "")
        self.assertTrue(
            self.source, "exact Tether checkout required, no fetch/fallback"
        )
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.db = self.root / "admission.sqlite"
        self.produce()

    def produce(self, *scenario: str) -> None:
        subprocess.run(
            [
                sys.executable,
                "-I",
                "-B",
                str(ROOT / "test_support/retained_producer.py"),
                self.source,
                str(self.db),
                *scenario,
            ],
            check=True,
            capture_output=True,
            timeout=10,
        )

    def run_export(
        self,
        source: str | None = None,
        optimized: bool = False,
        revision: int | None = 1,
    ) -> subprocess.CompletedProcess[bytes]:
        return subprocess.run(
            [
                sys.executable,
                "-I",
                "-B",
                *(["-O"] if optimized else []),
                str(ROOT / "tools/retained_snapshot.py"),
                "--source",
                source or self.source,
                "--database",
                str(self.db),
                "--task",
                "task",
                *(
                    ["--latest-head"]
                    if revision is None
                    else ["--revision", str(revision)]
                ),
            ],
            capture_output=True,
            timeout=10,
        )

    def test_optimized_export_identical_and_read_only(self) -> None:
        before = self.db.read_bytes()
        normal, optimized = self.run_export(), self.run_export(optimized=True)
        self.assertEqual(normal.returncode, 0, normal.stderr)
        self.assertEqual(optimized.returncode, 0, optimized.stderr)
        self.assertEqual(normal.stdout, optimized.stdout)
        self.assertEqual(before, self.db.read_bytes())
        self.assertNotIn(b"PRIVATE_CANARY", normal.stdout + normal.stderr)

    def test_retained_head_rejects_a_missing_or_misbound_predecessor(self) -> None:
        for index, corrupt in enumerate(
            (
                "DELETE FROM revisions WHERE revision='2'",
                "UPDATE revisions SET scope='[]' WHERE revision='2'",
                "UPDATE revisions SET kind='delete' WHERE revision='2'",
                "UPDATE revisions SET revision='02' WHERE revision='2'",
            )
        ):
            with self.subTest(corrupt=corrupt):
                self.db = self.root / f"history-{index}.sqlite"
                self.produce("edit-twice")
                self.assertEqual(self.run_export(revision=None).returncode, 0)
                with closing(sqlite3.connect(self.db)) as db, db:
                    db.execute(corrupt)
                before = self.db.read_bytes()
                for revision in (3, None):
                    result = self.run_export(optimized=True, revision=revision)
                    self.assertEqual((result.returncode, result.stdout), (2, b""))
                self.assertEqual(self.db.read_bytes(), before)

    def test_retained_head_cannot_point_past_a_later_deletion(self) -> None:
        self.db = self.root / "deleted.sqlite"
        self.produce("delete")
        self.assertEqual(self.run_export(revision=None).returncode, 0)
        with closing(sqlite3.connect(self.db)) as db, db:
            db.execute("UPDATE heads SET revision='1',deleted=0 WHERE task='task'")
        before = self.db.read_bytes()
        for revision in (1, None):
            result = self.run_export(revision=revision)
            self.assertEqual((result.returncode, result.stdout), (2, b""))
        self.assertEqual(self.db.read_bytes(), before)

    def test_unknown_top_level_bytecode_rejected_before_execution(self) -> None:
        checkout = self.root / "source"
        subprocess.run(
            ["git", "clone", "--shared", self.source, str(checkout)],
            check=True,
            capture_output=True,
            timeout=10,
        )
        marker = self.root / "executed"
        script = self.root / "injected.py"
        script.write_text(
            f"open({str(marker)!r},'w').write('executed')\nraise RuntimeError('PRIVATE_CANARY')\n"
        )
        py_compile.compile(str(script), cfile=str(checkout / "html.pyc"), doraise=True)
        with (checkout / ".git/info/exclude").open("a") as file:
            file.write("\n/html.pyc\n")
        before = self.db.read_bytes()
        result = self.run_export(str(checkout), optimized=True)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, b"")
        self.assertFalse(marker.exists())
        self.assertNotIn(b"PRIVATE_CANARY", result.stderr)
        self.assertEqual(before, self.db.read_bytes())

    def test_nonfinite_undisplayed_projection_values_reject(self) -> None:
        from tools.retained_snapshot import parse

        for token in ("NaN", "Infinity", "-Infinity"):
            with self.subTest(token=token):
                with self.assertRaises(ValueError):
                    parse('{"undisplayed":' + token + "}")
                with sqlite3.connect(self.db) as db:
                    body = (
                        '{"arguments":{"hidden":'
                        + token
                        + '},"kind":"input","message":"safe","version":"runspindle.projection.v1"}'
                    )
                    db.execute("UPDATE sanitized_projections SET body=?", (body,))
                before = self.db.read_bytes()
                result = self.run_export(optimized=True)
                self.assertEqual(result.returncode, 2)
                self.assertEqual(result.stdout, b"")
                self.assertEqual(before, self.db.read_bytes())

    def test_duplicate_json_and_large_counter_rejected_without_output(self) -> None:
        for change in ("duplicate", "counter"):
            with self.subTest(change=change):
                with sqlite3.connect(self.db) as db:
                    envelope = db.execute("SELECT envelope FROM revisions").fetchone()[
                        0
                    ]
                    if change == "duplicate":
                        db.execute(
                            "UPDATE revisions SET envelope=?",
                            ('{"version":"bad",' + envelope[1:],),
                        )
                    else:
                        value = json.loads(envelope)
                        value["binding"]["revision"] = 9007199254740992
                        db.execute(
                            "UPDATE revisions SET envelope=?",
                            (json.dumps(value, sort_keys=True, separators=(",", ":")),),
                        )
                before = self.db.read_bytes()
                result = self.run_export(optimized=True)
                self.assertEqual(result.returncode, 2)
                self.assertEqual(result.stdout, b"")
                self.assertEqual(before, self.db.read_bytes())


if __name__ == "__main__":
    unittest.main()
