#!/usr/bin/env python3
"""Bounded real Chromium DOM assertions; no server, install or sandbox bypass."""

import html
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]


def run_case(browser: str, directory: Path, mutation: bool = False) -> dict[str, Any]:
    sources = []
    for name in (
        "src/projection.js",
        "src/view.js",
        "fixtures/console-ui/scenarios.js",
        "test/view.assertions.js",
    ):
        source = (ROOT / name).read_text()
        if mutation and name == "src/view.js":
            needle = "node.textContent = displayText(value)"
            if source.count(needle) != 1:
                raise RuntimeError("mutation target missing")
            source = source.replace(needle, "node.innerHTML = displayText(value)")
        sources.append(source.replace("export ", ""))
    script = (
        "\n".join(sources)
        + """
(async () => {
  const result = document.getElementById('result');
  try {
    const count = await assertProjectionDom(document, createProjectionView, createProjection, consoleScenarios);
    result.textContent = JSON.stringify({status: 'passed', assertions: count});
  } catch { result.textContent = JSON.stringify({status: 'failed'}); }
})();
"""
    )
    script = script.replace("</script", "<\\/script")
    page = directory / "test.html"
    page.write_text(
        """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-console-dom'; connect-src 'none'; frame-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'">
<title>Offline synthetic Console DOM tests</title></head><body><pre id="result">pending</pre>
<script nonce="console-dom">"""
        + script
        + "</script></body></html>"
    )
    env = dict(os.environ)
    for key, child in [
        ("HOME", "home"),
        ("XDG_CONFIG_HOME", "config"),
        ("XDG_CACHE_HOME", "cache"),
    ]:
        path = directory / child
        path.mkdir()
        env[key] = str(path)
    result = subprocess.run(
        [
            browser,
            "--headless",
            "--disable-gpu",
            "--no-first-run",
            "--disable-background-networking",
            "--disable-component-update",
            "--disable-sync",
            "--host-resolver-rules=MAP * ~NOTFOUND",
            "--disable-extensions",
            "--user-data-dir=" + str(directory / "profile"),
            "--dump-dom",
            page.as_uri(),
        ],
        env=env,
        capture_output=True,
        text=True,
        timeout=25,
        check=False,
    )
    if result.returncode != 0:
        return {
            "status": "blocked",
            "reason": "normal_sandbox_browser_could_not_run",
            "exit_code": result.returncode,
        }
    match = re.search(r'<pre id="result">([^<]*)</pre>', result.stdout)
    if not match:
        return {"status": "failed", "reason": "missing_dom_result"}
    try:
        parsed = json.loads(html.unescape(match.group(1)))
        if not isinstance(parsed, dict) or parsed.get("status") not in (
            "passed",
            "failed",
        ):
            return {"status": "failed", "reason": "invalid_dom_result"}
        return dict(parsed)
    except (ValueError, TypeError):
        return {"status": "failed", "reason": "invalid_dom_result"}


def main() -> int:
    browser = shutil.which("chromium")
    if not browser:
        print(json.dumps({"status": "blocked", "reason": "chromium_missing"}))
        return 78
    version = subprocess.run(
        [browser, "--version"], capture_output=True, text=True, timeout=5, check=True
    ).stdout.strip()
    results = {}
    for name, mutation in [("actual_dom", False), ("unsafe_text_mutation", True)]:
        try:
            with tempfile.TemporaryDirectory(prefix="console-dom-") as temporary:
                results[name] = run_case(browser, Path(temporary), mutation)
        except subprocess.TimeoutExpired:
            results[name] = {"status": "blocked", "reason": "browser_timeout"}
        if results[name]["status"] == "blocked":
            print(
                json.dumps(
                    {"browser": version, "results": results, "status": "blocked"}
                )
            )
            return 78
    passed = (
        results["actual_dom"]["status"] == "passed"
        and results["unsafe_text_mutation"]["status"] == "failed"
    )
    print(
        json.dumps(
            {
                "browser": version,
                "results": results,
                "status": "passed" if passed else "failed",
            }
        )
    )
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
