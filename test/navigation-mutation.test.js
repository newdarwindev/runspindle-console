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

/** @type {Array<[string,string,string,RegExp]>} */
const mutations = [
  [
    "duplicate history",
    "if (selected === key && !unavailable) return !connecting;",
    "if (false) return true;",
    /4 !== 3/,
  ],
  ["refused admission", "if (result !== true) {", "if (false) {", /Unknown/],
  [
    "pending success",
    "if (selected === key && !unavailable) return !connecting;",
    "if (selected === key && !unavailable) return true;",
    /true !== false/,
  ],
];
for (const [name, needle, replacement, expected] of mutations) {
  test(`Navigation double detects ${name} mutation (not browser evidence)`, () => {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const temporary = mkdtempSync(
      join(tmpdir(), "console-navigation-mutation-"),
    );
    try {
      for (const file of [
        "package.json",
        "src/projection.js",
        "src/view.js",
        "src/stream.js",
        "src/navigation.js",
        "fixtures/console-ui/scenarios.js",
        "test/navigation.test.js",

        "test/dom-double.js",
      ]) {
        let source = readFileSync(join(root, file), "utf8");
        if (file === "src/navigation.js") {
          assert.equal(source.split(needle).length, 2);
          source = source.replace(needle, replacement);
        }
        mkdirSync(dirname(join(temporary, file)), { recursive: true });
        writeFileSync(join(temporary, file), source);
      }
      const child = spawnSync(
        process.execPath,
        ["--test", "test/navigation.test.js"],
        {
          cwd: temporary,
          env: Object.fromEntries(
            Object.entries(process.env).filter(
              ([key]) => key !== "NODE_TEST_CONTEXT",
            ),
          ),
          encoding: "utf8",
          timeout: 15000,
          maxBuffer: 65536,
        },
      );
      assert.equal(child.error, undefined);
      assert.equal(child.status, 1);
      assert.match(child.stdout, expected);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
}
