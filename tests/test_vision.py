"""SRC-010 static checks and negative cases; no browser acceptance claims."""

import hashlib
import json
import shutil
import tempfile
import unittest
from collections.abc import Callable
from pathlib import Path
from typing import TypedDict, cast

from tools import check_vision


class ArtifactRecord(TypedDict):
    path: str
    sha256: str


class ArtifactManifest(TypedDict):
    artifacts: list[ArtifactRecord]


class LiftFixture(TypedDict):
    """Only the JSON fixture fields mutated by these negative tests."""

    sections: list[dict[str, str]]
    rendering_assets: list[dict[str, str | int]]
    navigation: list[dict[str, str]]
    acceptance_status: str


class VisionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "repo"
        self.docs = self.root / "docs/product"
        shutil.copytree(check_vision.ROOT / "docs/product", self.docs)
        for name in (
            "STATUS.json",
            "provenance.json",
            "docs/IMPLEMENTATION_EVIDENCE.md",
        ):
            target = self.root / name
            target.parent.mkdir(exist_ok=True, parents=True)
            shutil.copyfile(check_vision.ROOT / name, target)

    def sync_hashes(self) -> None:
        path = self.docs / "artifacts.json"
        data = cast(ArtifactManifest, json.loads(path.read_text()))
        for item in data["artifacts"]:
            item["sha256"] = hashlib.sha256(
                (self.root / item["path"]).read_bytes()
            ).hexdigest()
        path.write_text(json.dumps(data))

    def html(self, old: str, new: str) -> None:
        path = self.docs / "vision.html"
        text = path.read_text()
        self.assertIn(old, text)
        path.write_text(text.replace(old, new, 1))
        self.sync_hashes()

    def record(self, mutate: Callable[[LiftFixture], object]) -> None:
        path = self.docs / "SRC-010-lift.json"
        data = cast(LiftFixture, json.loads(path.read_text()))
        mutate(data)
        path.write_text(json.dumps(data))
        self.sync_hashes()

    def reject(self, message: str) -> None:
        with self.assertRaisesRegex(ValueError, message):
            check_vision.validate(self.root)

    def test_valid_static_candidate_remains_visually_blocked(self) -> None:
        result = check_vision.validate(self.root)
        self.assertEqual(result["status"], "passed")
        self.assertEqual(result["visual_keyboard_zoom"], "blocked")
        self.assertEqual(result["runtime_acceptance"], "not_run")

    def test_script_rejected(self) -> None:
        self.html("</body>", "<script>alert(1)</script></body>")
        self.reject("executable or rendering dependency")

    def test_external_css_rejected(self) -> None:
        self.html("</style>", "@import 'https://example.invalid/theme.css';</style>")
        self.reject("CSS dependency")

    def test_event_handler_rejected(self) -> None:
        self.html("<body>", '<body onload="alert(1)">')
        self.reject("active or embedded asset")

    def test_unselected_pdf_link_rejected(self) -> None:
        self.html('href="index.html"', 'href="resources/unselected.pdf"')
        self.reject("missing or symlink link target")

    def test_unreviewed_external_link_rejected(self) -> None:
        self.html('href="index.html"', 'href="https://example.invalid/"')
        self.reject("unreviewed external link")

    def test_parent_traversal_rejected(self) -> None:
        self.html('href="index.html"', 'href="%2e%2e/IMPLEMENTATION_EVIDENCE.md"')
        self.reject("link escapes bundle")

    def test_broken_fragment_rejected(self) -> None:
        self.html('href="SRC-010-lift.json"', 'href="#missing"')
        self.reject("missing anchor")

    def test_duplicate_id_rejected(self) -> None:
        self.html("<footer>", '<footer id="main">')
        self.reject("duplicate HTML IDs")

    def test_missing_workflow_stage_rejected(self) -> None:
        self.html('id="rollback"', 'id="removed"')
        self.reject("seven ordered workflow stages")

    def test_missing_focus_rejected(self) -> None:
        self.html(":focus-visible", ":hover")
        self.html(":focus-visible", ":hover")
        self.reject("focus/reflow CSS")

    def test_zoom_lock_rejected(self) -> None:
        self.html(
            'content="width=device-width, initial-scale=1"',
            'content="width=device-width, user-scalable=no"',
        )
        self.reject("zoomable viewport")

    def test_approval_boundary_rejected(self) -> None:
        self.html(
            "Gold eligibility is separate from serving approval.",
            "All gold is ready to serve.",
        )
        self.reject("missing content boundary")

    def test_notice_tamper_rejected_even_with_matching_manifest(self) -> None:
        (self.docs / "LICENSE-SRC-010.txt").write_text("MIT without required notice")
        self.sync_hashes()
        self.reject("MIT notice changed")

    def test_incomplete_inventory_rejected(self) -> None:
        self.record(lambda d: d["sections"].pop())
        self.reject("incomplete section dispositions")

    def test_fake_visual_pass_rejected(self) -> None:
        self.record(lambda d: d.update({"acceptance_status": "passed"}))
        self.reject("unverified acceptance")

    def test_unselected_navigation_rejected(self) -> None:
        self.record(lambda d: d["navigation"][2].update(disposition="imported"))
        self.reject("navigation dispositions incomplete")

    def test_missing_asset_disposition_rejected(self) -> None:
        self.record(lambda d: d["rendering_assets"].pop())
        self.reject("rendering inventory incomplete")

    def test_private_path_rejected(self) -> None:
        self.html("</footer>", " private /home/example/task </footer>")
        self.reject("potential private material")

    def test_bad_artifact_digest_rejected(self) -> None:
        path = self.docs / "vision.html"
        path.write_text(path.read_text() + "\n")
        self.reject("artifact hash mismatch")

    def test_symlink_target_rejected(self) -> None:
        path = self.docs / "index.html"
        outside = self.root / "outside.html"
        path.replace(outside)
        path.symlink_to(outside)
        self.reject("link escapes bundle")

    def test_bundle_is_exact_and_refuses_overwrite(self) -> None:
        output = Path(self.temp.name) / "bundle"
        check_vision.bundle(self.root, output)
        self.assertEqual(
            {p.name: p.read_bytes() for p in self.docs.iterdir()},
            {p.name: p.read_bytes() for p in output.iterdir()},
        )
        with self.assertRaisesRegex(ValueError, "output already exists"):
            check_vision.bundle(self.root, output)
        self.assertEqual(
            (output / "vision.html").read_bytes(),
            (self.docs / "vision.html").read_bytes(),
        )

    def test_invalid_candidate_never_creates_bundle(self) -> None:
        self.html("</body>", "<form></form></body>")
        output = Path(self.temp.name) / "bundle"
        with self.assertRaises(ValueError):
            check_vision.bundle(self.root, output)
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
