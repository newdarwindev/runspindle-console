import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

test("DOM-double suite rejects unsafe innerHTML mutation (not browser evidence)", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const temporary = mkdtempSync(join(tmpdir(), "console-view-mutation-"));
  try {
    for (const file of [
      "package.json",
      "src/projection.js",
      "src/view.js",
      "fixtures/console-ui/scenarios.js",
      "test/view.assertions.js",
      "test/view.test.js",
      "test/dom-double.js",
    ]) {
      let source = readFileSync(join(root, file), "utf8");
      if (file === "src/view.js") {
        const needle = "node.textContent = displayText(value)";
        assert.equal(source.split(needle).length, 2);
        source = source.replace(needle, "node.innerHTML = displayText(value)");
      }
      mkdirSync(dirname(join(temporary, file)), { recursive: true });
      writeFileSync(join(temporary, file), source);
    }
    const child = spawnSync(process.execPath, ["--test", "test/view.test.js"], {
      cwd: temporary,
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => key !== "NODE_TEST_CONTEXT",
        ),
      ),
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 65536,
    });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 1);
    assert.match(child.stdout, /selected identity rendered/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
