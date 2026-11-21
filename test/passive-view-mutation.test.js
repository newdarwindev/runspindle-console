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

/** @type {Array<[string,string,string,string,RegExp,string,string?]>} */
const mutations = [
  [
    "unbounded passive acquisition",
    "src/projection.js",
    "return unknown || releasing > 0 || slot !== null;",
    "return unknown || releasing > 0;",
    /unresolved passive ownership must prevent another open/,
    "pending passive ownership survives",
  ],
  [
    "discarded cleanup uncertainty",
    "src/projection.js",
    "return unknown || releasing > 0 || slot !== null;",
    "return releasing > 0 || slot !== null;",
    /uncertain passive acquisition must block retries/,
    "rejected or malformed opens",
  ],
  [
    "reset ownership on stream replacement",
    "src/stream.js",
    "const projection = projectionFactory();",
    "const projection = createProjectionFactory({ ...options, readSnapshot: checkedSnapshot })();",
    /stream replacement must preserve passive ownership/,
    "shared ownership is retained across stream",
  ],
  [
    "release before authenticated server readback",
    "src/projection.js",
    "await read();",
    "void read().catch(() => {});",
    /pending readback must retain the revocation fence/,
    "authenticated readback reconciles lost revocation",
    "test/server-passive-revocation.test.js",
  ],
  [
    "stale snapshots on reconnect",
    "src/stream.js",
    "value.revision < checkpoint.record.revision ||",
    "",
    /replayed snapshot must not open a passive view/,
    "reconnect rejects older, conflicting and empty snapshots",
    "test/stream.test.js",
  ],
];
for (const [
  name,
  target,
  needle,
  replacement,
  expected,
  testName,
  testFile = "test/passive-view-lifecycle.test.js",
] of mutations) {
  test(`Passive lifecycle assertions detect ${name} mutation`, () => {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const temporary = mkdtempSync(join(tmpdir(), "console-passive-mutation-"));
    try {
      for (const file of [
        "package.json",
        "src/projection.js",
        "src/stream.js",
        testFile,
      ]) {
        let source = readFileSync(join(root, file), "utf8");
        if (file === target) {
          assert.equal(source.split(needle).length, 2, "exact mutation anchor");
          source = source.replace(needle, replacement);
        }
        mkdirSync(dirname(join(temporary, file)), { recursive: true });
        writeFileSync(join(temporary, file), source);
      }
      const child = spawnSync(
        process.execPath,
        ["--test", `--test-name-pattern=${testName}`, testFile],
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
