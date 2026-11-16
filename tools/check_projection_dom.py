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


def run_case(browser: str, directory: Path, mutation: bool | str = False) -> dict[str, Any]:
    sources = []
    names = (
        "src/projection.js",
        "src/view.js",
        "fixtures/console-ui/scenarios.js",
        "test/view.assertions.js",
    )
    navigation = mutation in ("navigation", "history")
    if navigation:
        names += (
            "src/stream.js",
            "src/navigation.js",
            "test/navigation-browser.assertions.js",
        )
    for name in names:
        source = (ROOT / name).read_text()
        if mutation is True and name == "src/view.js":
            needle = "node.textContent = displayText(value)"
            if source.count(needle) != 1:
                raise RuntimeError("mutation target missing")
            source = source.replace(needle, "node.innerHTML = displayText(value)")
        if mutation == "reflow" and name == "src/view.js":
            needle = 'panel.style.overflowWrap = "anywhere";'
            if source.count(needle) != 1:
                raise RuntimeError("reflow mutation target missing")
            source = source.replace(needle, 'panel.style.overflowWrap = "normal";')
        if name in ("src/stream.js", "src/navigation.js"):
            source = re.sub(
                r'^import \{[^\n]+\} from "\./[^"\n]+";\n',
                "", source, flags=re.MULTILINE,
            )
        if mutation == "history" and name == "src/navigation.js":
            needle = 'browser.addEventListener("popstate", callback);'
            if source.count(needle) != 1:
                raise RuntimeError("history mutation target missing")
            source = source.replace(
                needle, 'browser.addEventListener("never-popstate", callback);'
            )
        sources.append(source.replace("export ", ""))
    script = (
        "\n".join(sources)
        + """
(async () => {
  const result = document.getElementById('result');
  try {
    const count = await assertProjectionDom(document, createProjectionView, createProjection, consoleScenarios);
    result.textContent = JSON.stringify({status: 'passed', assertions: count});
  } catch (error) {
    result.textContent = JSON.stringify({status: 'failed', reason:
      error instanceof Error && error.message === 'long text reflows without horizontal overflow'
        ? 'long_text_overflow' : 'assertion_failed'});
  }
})();
"""
    )
    if navigation:
        script = script.replace(
            "assertProjectionDom(document, createProjectionView, createProjection, consoleScenarios)",
            "assertNavigationBrowser(window, createTaskNavigator, createBrowserTaskHistory, createStreamProjection, consoleScenarios, consoleTaskCatalog)",
        )
        script = script.replace(
            "'long text reflows without horizontal overflow'", "'history navigation timeout'"
        ).replace("'long_text_overflow'", "'history_navigation_timeout'")
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
            "--virtual-time-budget=3000",
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
    browser = shutil.which(os.environ.get("RUNSPINDLE_DOM_BROWSER", "chromium"))
    if not browser:
        print(json.dumps({"status": "blocked", "reason": "chromium_missing"}))
        return 78
    version = subprocess.run(
        [browser, "--version"], capture_output=True, text=True, timeout=5, check=True
    ).stdout.strip()
    results = {}
    for name, mutation in [
        ("actual_dom", False),
        ("unsafe_text_mutation", True),
        ("reflow_mutation", "reflow"),
        ("navigation_actual", "navigation"),
        ("history_mutation", "history"),
    ]:
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
        and results["reflow_mutation"]["status"] == "failed"
        and results["reflow_mutation"].get("reason") == "long_text_overflow"
        and results["navigation_actual"]["status"] == "passed"
        and results["history_mutation"].get("reason") == "history_navigation_timeout"
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
