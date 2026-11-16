import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
const modulePath = process.env.RETAINED_PROCESS_MODULE;
const { createRetainedSnapshotReader } = await import(
  modulePath ? pathToFileURL(modulePath).href : "../src/retained-snapshot.js"
);
const id = { task: "task", host: "host", workspace: "workspace" };

/** @param {string} path */
async function until(path) {
  for (let n = 0; n < 100 && !existsSync(path); n++) await delay(50);
  assert.ok(existsSync(path), "bounded synthetic descendant completed");
}
/** @param {import("node:test").TestContext} t @param {boolean} [inherited] */
function fixture(t, inherited = true) {
  const root = mkdtempSync(join(tmpdir(), "retained-process-"));
  const script = join(root, "interpreter");
  const marker = join(root, "launches");
  const done = join(root, "done");
  const payload = `import time,pathlib; time.sleep(2.5); pathlib.Path(${JSON.stringify(done)}).write_text('done')`;
  writeFileSync(
    script,
    `#!/usr/bin/env python3\nimport pathlib,subprocess,time\np=pathlib.Path(${JSON.stringify(marker)})\np.write_text(p.read_text()+'1' if p.exists() else '1')\n` +
      (inherited
        ? `subprocess.Popen(['python3','-c',${JSON.stringify(payload)}])\n`
        : "time.sleep(2.5)\n"),
    { mode: 0o700 },
  );
  t.after(async () => {
    if (inherited) await until(done);
    rmSync(root, { recursive: true, force: true });
  });
  return { script, marker };
}

test(
  "inherited pipes cannot extend read deadline or permit replacement",
  { timeout: 8000 },
  async (t) => {
    const { script, marker } = fixture(t);
    const reader = createRetainedSnapshotReader({
      source: "synthetic",
      database: "synthetic",
      revision: 1,
      python: script,
      timeoutMs: 400,
    });
    const started = globalThis.performance.now();
    await assert.rejects(reader(id), /retained snapshot unavailable/);
    assert.ok(
      globalThis.performance.now() - started < 1500,
      "read must not wait for inherited EOF",
    );
    assert.deepEqual(reader.state(), { pending: false, cleanup: "unknown" });
    await assert.rejects(reader(id));
    assert.equal(
      readFileSync(marker, "utf8"),
      "1",
      "no replacement process after unknown cleanup",
    );
  },
);

test(
  "abort rejects promptly, blocks overlap and preserves cleanup uncertainty",
  { timeout: 5000 },
  async (t) => {
    const { script, marker } = fixture(t, false);
    const controller = new globalThis.AbortController();
    const reader = createRetainedSnapshotReader({
      source: "synthetic",
      database: "synthetic",
      revision: 1,
      python: script,
      timeoutMs: 3000,
    });
    const pending = reader(id, { signal: controller.signal });
    const rejected = assert.rejects(pending, /retained snapshot unavailable/);
    await until(marker);
    await assert.rejects(reader(id));
    assert.equal(readFileSync(marker, "utf8"), "1");
    controller.abort();
    await rejected;
    await assert.rejects(reader(id));
    assert.equal(reader.state().cleanup, "unknown");
  },
);

test("pre-aborted and missing executable reads do not poison an unused reader", async () => {
  const controller = new globalThis.AbortController();
  controller.abort();
  const reader = createRetainedSnapshotReader({
    source: "synthetic",
    database: "synthetic",
    revision: 1,
    python: "/nonexistent/runspindle-synthetic-interpreter",
  });
  await assert.rejects(reader(id, { signal: controller.signal }));
  assert.deepEqual(reader.state(), {
    pending: false,
    cleanup: "no_unconfirmed_process",
  });
  await assert.rejects(reader(id));
  assert.deepEqual(reader.state(), {
    pending: false,
    cleanup: "no_unconfirmed_process",
  });
});

test(
  "deliberate deadline mutation fails inherited-pipe regression",
  { timeout: 12000 },
  (t) => {
    if (modulePath) return;
    const root = mkdtempSync(join(tmpdir(), "retained-deadline-mutant-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "dependencies"));
    writeFileSync(
      join(root, "dependencies/tether-snapshot.json"),
      readFileSync(
        new URL("../dependencies/tether-snapshot.json", import.meta.url),
      ),
    );
    const source = readFileSync(
      new URL("../src/retained-snapshot.js", import.meta.url),
      "utf8",
    );
    const anchor = "const timer = setTimeout(stop, timeoutMs);";
    assert.equal(source.split(anchor).length, 2);
    const mutant = join(root, "src/mutant.mjs");
    writeFileSync(
      mutant,
      source.replace(
        anchor,
        "const timer = setTimeout(stop, timeoutMs + 5000);",
      ),
    );
    const result = spawnSync(
      process.execPath,
      [
        "--test",
        "--test-name-pattern=inherited pipes",
        "test/retained-process.test.js",
      ],
      {
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              ([key]) => key !== "NODE_TEST_CONTEXT",
            ),
          ),
          RETAINED_PROCESS_MODULE: mutant,
        },
        encoding: "utf8",
        timeout: 9000,
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /read must not wait for inherited EOF/);
  },
);
