#!/usr/bin/env python3
"""Static SRC-010 integrity checks; never a browser or runtime acceptance gate."""

import argparse
import hashlib
import json
import re
import shutil
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from typing import cast
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
EXTERNAL = {
    "https://github.com/newdarwindev/runspindle-console/blob/main/STATUS.json",
    "https://github.com/newdarwindev/runspindle-console/blob/main/docs/IMPLEMENTATION_EVIDENCE.md",
}
STAGES = ("select", "review", "gold", "candidates", "evaluate", "approve", "rollback")
UNITS = {
    "hero",
    "premise",
    "limits",
    "domains-internal",
    "domains-orchestration",
    "domains-external",
    "human-constraints",
    *("loop-" + x for x in STAGES),
    "hypothesis-1",
    "hypothesis-2",
    "hypothesis-3",
    "simulation-warning",
    "materials",
}
NOTICE_SHA256 = "fcf64df3e04554728cc4f082f244fa3dc672c2c6368f22360e6491a113204895"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Page(HTMLParser):
    def __init__(self, text: str) -> None:
        super().__init__(convert_charrefs=True)
        self.ids: list[str | None] = []
        self.elements: list[tuple[str, dict[str, str | None]]] = []
        self.links: list[str | None] = []
        self.parts: list[str] = []
        self.feed(text)
        self.close()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        self.elements.append((tag, attributes))
        if "id" in attributes:
            self.ids.append(attributes["id"])
        if tag == "a":
            self.links.append(attributes.get("href", ""))

    handle_startendtag = handle_starttag

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def check_links(folder: Path, page: Page, name: str) -> None:
    for raw_link in page.links:
        require(bool(raw_link), "empty link in " + name)
        # HTMLParser permits a valueless href; the guard above rejects it.
        link = cast(str, raw_link)
        parsed = urlsplit(link)
        if parsed.scheme or parsed.netloc:
            require(link in EXTERNAL, "unreviewed external link in " + name)
            continue
        require(not parsed.query, "unexpected query in " + name)
        decoded = unquote(parsed.path)
        require(not decoded.startswith(("/", "\\")), "absolute local link")
        target = (folder / (decoded or name)).resolve()
        require(target.is_relative_to(folder.resolve()), "link escapes bundle")
        require(
            target.is_file() and not (folder / decoded).is_symlink(),
            "missing or symlink link target",
        )
        if parsed.fragment:
            require(target.suffix == ".html", "fragment on non-HTML resource")
            require(
                unquote(parsed.fragment) in Page(target.read_text()).ids,
                "missing anchor",
            )


def validate(root: Path = ROOT) -> dict[str, str]:
    folder = root / "docs/product"
    text = (folder / "vision.html").read_text()
    page = Page(text)
    require(len(page.ids) == len(set(page.ids)), "duplicate HTML IDs")
    tags = Counter(t for t, _ in page.elements)
    require(
        tags["h1"] == tags["main"] == tags["header"] == tags["footer"] == 1,
        "semantic landmarks missing",
    )
    require(tags["style"] == 1, "expected one inline stylesheet")
    require(
        not set(tags)
        & {
            "script",
            "form",
            "iframe",
            "img",
            "svg",
            "canvas",
            "object",
            "embed",
            "link",
            "video",
            "audio",
            "base",
        },
        "executable or rendering dependency",
    )
    for _, attrs in page.elements:
        require(
            not any(
                k.startswith("on") or k in {"src", "srcset", "style"} for k in attrs
            ),
            "active or embedded asset attribute",
        )
    require(
        not re.search(r"url\s*\(|@import|expression\s*\(", text, re.I), "CSS dependency"
    )
    require(
        any(t == "html" and a.get("lang") == "en" for t, a in page.elements),
        "document language",
    )
    require(
        any(
            t == "meta"
            and a.get("name") == "viewport"
            and a.get("content") == "width=device-width, initial-scale=1"
            for t, a in page.elements
        ),
        "zoomable viewport",
    )
    require(
        any(
            t == "a" and a.get("class") == "skip" and a.get("href") == "#main"
            for t, a in page.elements
        ),
        "skip navigation",
    )
    require(
        any(
            t == "main" and a.get("id") == "main" and a.get("tabindex") == "-1"
            for t, a in page.elements
        ),
        "skip focus target",
    )
    require(
        ":focus-visible" in text
        and "@media(max-width:" in text
        and "overflow-wrap:anywhere" in text,
        "focus/reflow CSS declarations",
    )
    actual_stages = [
        a.get("id") for t, a in page.elements if t == "li" and a.get("id") in STAGES
    ]
    require(actual_stages == list(STAGES), "seven ordered workflow stages")
    plain = " ".join(" ".join(page.parts).split())
    for phrase in (
        "Design narrative, not a live service.",
        "immutable output ID, revision and digest",
        "Gold eligibility is separate from serving approval.",
        "Evaluation passed, approved, promoted and serving are different facts.",
        "planned, stub, synthetic, component, isolated integration and live acceptance",
        "observation time, source, sequence, revision and freshness policy",
        "Historical demo numbers were simulated",
        "Historical white paper: unavailable",
        "Historical presentation: unavailable and unselected",
        "SRC-010",
        "SRC-005",
        "SRC-013",
    ):
        require(phrase in plain, "missing content boundary: " + phrase)
    for html in folder.glob("*.html"):
        check_links(folder, Page(html.read_text()), html.name)
    require(
        set(x for x in page.links if x is not None and x.startswith("https:"))
        == EXTERNAL,
        "public evidence links",
    )
    for url in EXTERNAL:
        require(
            (root / url.split("/blob/main/")[1]).is_file(),
            "public evidence target missing from repository",
        )
    for name in (
        "SRC-010-lift.json",
        "SRC-010-validation.md",
        "THIRD_PARTY_NOTICES.md",
        "LICENSE-SRC-010.txt",
    ):
        require(name in page.links, "missing source record link")
    require(
        sha(folder / "LICENSE-SRC-010.txt") == NOTICE_SHA256,
        "SRC-010 MIT notice changed",
    )
    record = json.loads((folder / "SRC-010-lift.json").read_text())
    require(
        record["source_id"] == "SRC-010" and record["scope_accounting"] == "complete",
        "source identity/scope",
    )
    require(
        record["classification"] == "reviewed_adapted_static_document"
        and record["historical_original_republished"] is False,
        "adaptation classification",
    )
    require(
        record["acceptance_status"] == "blocked_visual_review"
        and record["executable_runtime_implementation"] == "none",
        "unverified acceptance",
    )
    require(
        record["overall_selected_source_migration"] == "partial",
        "migration not complete",
    )
    require(
        record["source_inventory"]
        == {
            "sections": 4,
            "navigation_links": 3,
            "inline_stylesheets": 1,
            "scripts": 0,
            "figures": 0,
            "external_rendering_assets": 0,
        },
        "source dependency inventory",
    )
    units = record["sections"]
    require(
        len(units) == len(UNITS) and {x["id"] for x in units} == UNITS,
        "incomplete section dispositions",
    )
    for item in units:
        require(
            item["disposition"] == "adapted" and bool(item["review_decision"]),
            "section disposition missing",
        )
        if item["destination"].startswith("#"):
            require(
                item["destination"][1:] in page.ids, "disposition destination missing"
            )
    assets = {x["id"]: x for x in record["rendering_assets"]}
    require(
        set(assets)
        == {"inline-css", "diagrams", "scripts", "external-rendering-assets"},
        "rendering inventory incomplete",
    )
    require(assets["inline-css"]["disposition"] == "replaced", "stylesheet disposition")
    for key in ("diagrams", "scripts", "external-rendering-assets"):
        require(
            assets[key]["source_count"] == 0
            and assets[key]["disposition"] == "not_present",
            "unexpected source dependency",
        )
    navigation = record["navigation"]
    require(
        len(navigation) == 3
        and {x["id"]: x["disposition"] for x in navigation}
        == {
            "historical-demo": "replaced",
            "historical-white-paper": "unavailable",
            "historical-presentation": "unselected_excluded",
        },
        "navigation dispositions incomplete",
    )
    for item in navigation:
        check_links(
            folder,
            Page('<a href="' + item["destination"] + '">target</a>'),
            "vision.html",
        )
    require(len(record["unresolved_acceptance"]) == 3, "missing visual blockers")
    source = next(
        x
        for x in json.loads((root / "provenance.json").read_text())["sources"]
        if x["source_id"] == "SRC-010"
    )
    require(
        source["artifact_acceptance"] == "blocked_visual_review"
        and source["migration_status"] == "partial",
        "provenance overclaims",
    )
    require(
        source["verified_behavior"] == "static_integrity_only"
        and source["executable_implementation"] == "none",
        "provenance behavior",
    )
    require(
        source["destination"] == "docs/product/vision.html"
        and source["notice"] == "docs/product/LICENSE-SRC-010.txt",
        "provenance attribution",
    )
    manifest = json.loads((folder / "artifacts.json").read_text())
    paths = [x["path"] for x in manifest["artifacts"]]
    require(len(paths) == len(set(paths)), "duplicate artifact records")
    for name in (
        "vision.html",
        "LICENSE-SRC-010.txt",
        "SRC-010-lift.json",
        "SRC-010-validation.md",
    ):
        require("docs/product/" + name in paths, "missing SRC-010 manifest entry")
    for item in manifest["artifacts"]:
        path = (root / item["path"]).resolve()
        require(
            path.is_relative_to(folder.resolve()) and path.is_file(),
            "artifact outside product bundle",
        )
        require(not (root / item["path"]).is_symlink(), "symlink artifact")
        require(sha(path) == item["sha256"], "artifact hash mismatch: " + path.name)
        if path.name == "vision.html":
            require(
                "SRC-010" in item["source_ids"]
                and item["historical_original"] is False
                and item["implementation_evidence"] is False,
                "artifact classification",
            )
            require(
                item["verification"]
                == {
                    "static_integrity": "passed",
                    "visual_keyboard_zoom": "blocked",
                    "runtime": "not_implemented",
                },
                "artifact evidence status",
            )
    # Defense-in-depth pattern checks are not a substitute for human content review.
    forbidden = (
        r"(?:/home/|/workspace/|file://)",
        r"https?://[^\s<>\"']*(?:localhost|127\.0\.0\.1)",
        r"github\.com/[^/\s]+/dots-",
        r"\b(?:ghp_|github_pat_|sk_live_)[A-Za-z0-9_]+",
        r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
        r"\bC0[A-Z0-9]{9}\b",
    )
    for path in folder.iterdir():
        require(path.is_file() and not path.is_symlink(), "non-file bundle entry")
        contents = path.read_text()
        require(
            not any(re.search(pattern, contents) for pattern in forbidden),
            "potential private material: " + path.name,
        )
    return {
        "status": "passed",
        "evidence_class": "static_document_integrity",
        "source_id": "SRC-010",
        "vision_sha256": sha(folder / "vision.html"),
        "visual_keyboard_zoom": "blocked",
        "runtime_acceptance": "not_run",
    }


def bundle(root: Path, destination: Path) -> None:
    validate(root)
    # Refuse existing paths to avoid overwrites and symlink traversal.
    require(
        not destination.exists() and not destination.is_symlink(),
        "output already exists",
    )
    destination.mkdir(parents=True)
    for path in sorted((root / "docs/product").iterdir()):
        shutil.copyfile(path, destination / path.name)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = validate()
    if args.output is not None:
        bundle(ROOT, args.output)
        result["bundle"] = "byte_preserved_static_files"
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
