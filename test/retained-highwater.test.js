import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRetainedHighwater } from "../src/retained-highwater.js";
const identity = { task: "task", host: "host", workspace: "workspace" };
/** @param {string[]} args */
function run(args) {
  return spawnSync("python3", ["-I", "-B", ...args], {
    encoding: "utf8",
    timeout: 5000,
  });
}
/** @param {import("node:test").TestContext} t */
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "retained-fence-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const highwater = join(dir, "fence.sqlite");
  assert.equal(
    run(["tools/retained_highwater.py", highwater, "--initialize"]).status,
    0,
  );
  const options = { highwater, database: join(dir, "source.sqlite"), identity };
  return { ...options, guard: createRetainedHighwater(options) };
}
test("fresh process rejects rollback and same-revision substitution with digest-only persistence", (t) => {
  const f = setup(t);
  f.guard({ revision: 2, label: "secret-canary" });
  const code = `import {createRetainedHighwater} from './src/retained-highwater.js';createRetainedHighwater(JSON.parse(process.argv[1]))(JSON.parse(process.argv[2]));`;
  for (const record of [
    { revision: 1, label: "old" },
    { revision: 2, label: "changed" },
  ]) {
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        code,
        JSON.stringify(f),
        JSON.stringify(record),
      ],
      { encoding: "utf8", timeout: 5000 },
    );
    assert.notEqual(child.status, 0);
  }
  f.guard({ revision: 2, label: "secret-canary" });
  assert.equal(
    readFileSync(f.highwater).includes(Buffer.from("secret-canary")),
    false,
  );
  f.guard({ revision: 3, label: "new" });
});
test("missing, corrupt, symlinked and empty store fail closed without recreation", (t) => {
  const f = setup(t);
  f.guard({ revision: 1 });
  const before = readFileSync(f.highwater);
  const missing = join(f.database, "missing");
  assert.throws(() =>
    createRetainedHighwater({ ...f, highwater: missing })({ revision: 1 }),
  );
  const alias = f.highwater + "-alias";
  symlinkSync(f.highwater, alias);
  assert.throws(() =>
    createRetainedHighwater({ ...f, highwater: alias })({ revision: 1 }),
  );
  assert.deepEqual(readFileSync(f.highwater), before);
  assert.equal(
    run([
      "-c",
      "import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute('DELETE FROM fence');c.commit()",
      f.highwater,
    ]).status,
    0,
  );
  assert.throws(() => f.guard({ revision: 2 }));
  writeFileSync(f.highwater, "corrupt");
  assert.throws(() => f.guard({ revision: 2 }));
});
test("binding substitution, second initialization and extra trigger reject", (t) => {
  const f = setup(t);
  f.guard({ revision: 1 });
  assert.throws(() =>
    createRetainedHighwater({ ...f, identity: { ...identity, host: "other" } })(
      { revision: 2 },
    ),
  );
  assert.notEqual(
    run(["tools/retained_highwater.py", f.highwater, "--initialize"]).status,
    0,
  );
  assert.equal(
    run([
      "-c",
      `import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute("CREATE TRIGGER bypass AFTER INSERT ON fence BEGIN DELETE FROM fence; END");c.commit()`,
      f.highwater,
    ]).status,
    0,
  );
  assert.throws(() => f.guard({ revision: 2 }));
});

test("independent SQLite receipt preserves latest committed observation under competing writers", async (t) => {
  const f = setup(t);
  f.guard({ revision: 1 });
  const { spawn } = await import("node:child_process");
  const code = `import {createRetainedHighwater} from './src/retained-highwater.js';createRetainedHighwater(JSON.parse(process.argv[1]))({revision:Number(process.argv[2])});`;
  const outcomes = await Promise.all(
    [2, 3].map(
      (revision) =>
        new Promise((resolve) => {
          const child = spawn(
            process.execPath,
            [
              "--input-type=module",
              "-e",
              code,
              JSON.stringify(f),
              String(revision),
            ],
            { stdio: "ignore" },
          );
          child.on("close", (status) => resolve(status));
        }),
    ),
  );
  assert.ok(outcomes.includes(0));
  // Either the lower write loses the lock or commits first; the higher may
  // lose a busy transaction too, so inspect rather than assume its outcome.
  const result = run([
    "-c",
    "import sqlite3,sys,json;c=sqlite3.connect(sys.argv[1]);print(json.dumps(c.execute('SELECT revision FROM fence').fetchone()))",
    f.highwater,
  ]);
  const [revision] = JSON.parse(result.stdout);
  assert.ok(revision === 2 || revision === 3);
  assert.throws(() => f.guard({ revision: revision - 1 }));
});

test("busy fence times out without resetting committed high-water", async (t) => {
  const f = setup(t);
  f.guard({ revision: 2 });
  const { spawn } = await import("node:child_process");
  const child = spawn(
    "python3",
    [
      "-I",
      "-c",
      "import sqlite3,sys,time;c=sqlite3.connect(sys.argv[1]);c.execute('BEGIN IMMEDIATE');print('ready',flush=True);time.sleep(3)",
      f.highwater,
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  t.after(() => child.kill());
  await new Promise((resolve) => child.stdout.once("data", resolve));
  assert.throws(() => f.guard({ revision: 3 }));
  child.kill();
  await new Promise((resolve) => child.once("close", resolve));
  assert.throws(() => f.guard({ revision: 1 }));
  f.guard({ revision: 2 });
});

test("deliberately removed rollback guard permits independently observable forbidden persistence", (t) => {
  const f = setup(t);
  const binding = "a".repeat(64);
  /** @param {string} helper @param {number} revision */
  const invoke = (helper, revision) =>
    spawnSync("python3", ["-I", "-B", helper, f.highwater], {
      input: JSON.stringify({ binding, record: { revision } }),
      encoding: "utf8",
      timeout: 5000,
    });
  assert.equal(invoke("tools/retained_highwater.py", 2).status, 0);
  assert.notEqual(invoke("tools/retained_highwater.py", 1).status, 0);
  const source = readFileSync("tools/retained_highwater.py", "utf8");
  const needle = "require(revision >= previous)";
  assert.equal(source.split(needle).length, 2);
  const mutant = f.highwater + ".py";
  writeFileSync(mutant, source.replace(needle, "require(True)"));
  assert.equal(invoke(mutant, 1).status, 0);
  const observed = run([
    "-c",
    "import sqlite3,sys;print(sqlite3.connect(sys.argv[1]).execute('SELECT revision FROM fence').fetchone()[0])",
    f.highwater,
  ]);
  assert.equal(observed.stdout.trim(), "1");
});

test("non-bootstrap zero revision and dangling sidecars are rejected", (t) => {
  const f = setup(t);
  f.guard({ revision: 2 });
  const alias = f.highwater + "-wal";
  symlinkSync(f.highwater + "-missing", alias);
  assert.throws(() => f.guard({ revision: 3 }));
  rmSync(alias);
  assert.equal(
    run([
      "-c",
      "import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute('UPDATE fence SET revision=0');c.commit()",
      f.highwater,
    ]).status,
    0,
  );
  assert.throws(() => f.guard({ revision: 1 }));
});

test("removing the terminal check admits a prohibited higher revision", (t) => {
  const f = setup(t);
  const binding = "a".repeat(64);
  const tombstone = { revision: 2, label: "", deleted: true };
  const later = { revision: 3, label: "fixture" };
  /** @param {string} helper @param {{revision:number,label:string,deleted?:boolean}} record */
  const invoke = (helper, record) =>
    spawnSync("python3", ["-I", "-B", helper, f.highwater], {
      input: JSON.stringify({ binding, record }),
      encoding: "utf8",
      timeout: 5000,
    });
  const helper = "tools/retained_highwater.py";
  assert.equal(invoke(helper, tombstone).status, 0);
  assert.equal(invoke(helper, tombstone).status, 0);
  assert.notEqual(invoke(helper, later).status, 0);
  const original = readFileSync(helper, "utf8");
  const guard = "require(not terminal or revision == previous)";
  assert.equal(original.split(guard).length, 2);
  const mutant = f.highwater + ".py";
  writeFileSync(mutant, original.replace(guard, "require(True)"));
  assert.equal(invoke(mutant, later).status, 0);
  const observed = run([
    "-c",
    "import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);print(c.execute('SELECT revision,deleted FROM fence').fetchone());c.close()",
    f.highwater,
  ]);
  assert.equal(observed.stdout.trim(), "(3, 0)");
});
