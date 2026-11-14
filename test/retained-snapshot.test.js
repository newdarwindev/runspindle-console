import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  createRetainedDecoder,
  createRetainedSnapshotReader,
} from "../src/retained-snapshot.js";
import { createProjection } from "../src/projection.js";
const source = process.env.RUNSPINDLE_RETAINED_TETHER ?? "";
/** @type {(options: any) => any} */
const project = createProjection;
const id = { task: "task", host: "host", workspace: "workspace" };
const pin = JSON.parse(
  readFileSync(
    new URL("../dependencies/tether-snapshot.json", import.meta.url),
    "utf8",
  ),
).commit;
const version = "runspindle.console.retained.v1";
/** @param {any} value @returns {string} */
function canonical(value) {
  return value && typeof value === "object"
    ? "{" +
        Object.keys(value)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
          .join(",") +
        "}"
    : JSON.stringify(value);
}
/** @returns {Record<string, any>[]} */
function frames() {
  return [
    {
      version,
      type: "begin",
      sequence: 0,
      identity: id,
      revision: 1,
      source: pin,
    },
    {
      version,
      type: "snapshot",
      sequence: 1,
      identity: id,
      revision: 1,
      label: "<retained>",
      deleted: false,
      observedAt: null,
      authority: "unknown",
      connection: "unknown",
    },
    { version, type: "end", sequence: 2 },
  ];
}
function wire(values = frames()) {
  return Buffer.from(values.map(canonical).join("\n") + "\n");
}
/** @param {string[]} args */
function python(args) {
  const result = spawnSync("python3", ["-I", "-B", ...args], {
    timeout: 10000,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
/** @param {import("node:test").TestContext} t @param {string} [mode] */
function setup(t, mode) {
  assert.ok(
    source,
    "RUNSPINDLE_RETAINED_TETHER exact checkout is required; no fetch/fallback",
  );
  const root = mkdtempSync(join(tmpdir(), "retained-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const database = join(root, "admission.sqlite");
  python([
    "test_support/retained_producer.py",
    source,
    database,
    ...(mode ? [mode] : []),
  ]);
  return { root, database };
}
/** @param {string} database @param {string} statement */
function sql(database, statement) {
  python([
    "-c",
    "import sqlite3,sys; d=sqlite3.connect(sys.argv[1]); d.execute(sys.argv[2]); d.commit(); d.close()",
    database,
    statement,
  ]);
}

test("strict complete frames and UTF8 chunks retain unknown provenance", () => {
  const decoder = createRetainedDecoder(id, 1);
  for (const byte of wire()) decoder.push(Uint8Array.of(byte));
  const result = decoder.finish();
  assert.equal(result.observedAt, null);
  assert.equal(result.evidenceClass, "retained_local");
  const p = project({ clock: () => 100 });
  p.select(id);
  assert.equal(p.merge(result, { snapshot: true }), true);
  assert.equal(p.state().status, "unknown");
  assert.equal(p.state().canExecute, false);
  assert.equal(p.state().viewLabel, "View unavailable");
  assert.throws(() => decoder.finish());
});
test("malformed duplicate reordered foreign oversize truncated frames fail closed", () => {
  /** @type {Array<(values: Record<string, any>[]) => void>} */
  const mutations = [
    (v) => {
      v[1].identity = { ...id, task: "other" };
    },
    (v) => {
      v[1].sequence = 2;
    },
    (v) => {
      v[0].source = "0".repeat(40);
    },
    (v) => {
      v[1].authority = "agent";
    },
    (v) => {
      v[1].observedAt = 100;
    },
    (v) => {
      v[1].label = "x".repeat(4097);
    },
    (v) => {
      v[1].unknown = true;
    },
    (v) => {
      v.push(v[2]);
    },
    (v) => {
      v.pop();
    },
  ];
  for (const mutate of mutations) {
    const v = frames();
    mutate(v);
    const d = createRetainedDecoder(id, 1);
    assert.throws(() => {
      d.push(wire(v));
      d.finish();
    });
  }
  for (const bytes of [
    Buffer.from('{"version":"x","version":"y"}\n'),
    Buffer.from([255]),
    Buffer.alloc(16385, 32),
    wire().subarray(0, wire().length - 1),
  ]) {
    const d = createRetainedDecoder(id, 1);
    assert.throws(() => {
      d.push(bytes);
      d.finish();
    });
  }
});
test("actual writer/exporter/Node reader preserve database and sanitized label", async (t) => {
  const { database } = setup(t);
  const before = readFileSync(database);
  const read = createRetainedSnapshotReader({ source, database, revision: 1 });
  const first = await read(id);
  const second = await read(id);
  assert.deepEqual(first, second);
  assert.match(first.label, /\[redacted\]/);
  assert.ok(!first.label.includes("PRIVATE_CANARY"));
  assert.deepEqual(readFileSync(database), before);
  const rows = JSON.parse(
    python([
      "-c",
      'import sqlite3,json,sys; d=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True); print(json.dumps([d.execute("SELECT count(*) FROM revisions").fetchone()[0],d.execute("SELECT count(*) FROM sanitized_projections").fetchone()[0],d.execute("SELECT revision FROM heads").fetchone()[0]]))',
      database,
    ]),
  );
  assert.deepEqual(rows, [1, 1, "1"]);
  await assert.rejects(read({ ...id, workspace: "other" }));
});
test("actual store cross-record corruption and incompatible schema reject without writes", async (t) => {
  const changes = [
    "UPDATE revisions SET scope='[]'",
    "UPDATE heads SET revision='2'",
    "UPDATE deliveries SET digest='wrong'",
    'UPDATE sanitized_projections SET body=\'{"version":"wrong"}\'',
    "PRAGMA user_version=999",
    "DROP TABLE sanitized_projections",
  ];
  for (const change of changes) {
    const { database } = setup(t);
    sql(database, change);
    const before = readFileSync(database);
    await assert.rejects(
      createRetainedSnapshotReader({ source, database, revision: 1 })(id),
    );
    assert.deepEqual(readFileSync(database), before);
  }
});
test("deleted intent omits prior projection; missing selection rejects", async (t) => {
  const { database } = setup(t);
  // Deliberate synthetic retained-row corruption is rejected, not interpreted as deletion.
  sql(database, "UPDATE heads SET deleted=1");
  await assert.rejects(
    createRetainedSnapshotReader({ source, database, revision: 1 })(id),
  );
  await assert.rejects(
    createRetainedSnapshotReader({ source, database, revision: 2 })(id),
  );
});
test("cancellation and task switch cannot populate current projection", async (t) => {
  const { database } = setup(t);
  const read = createRetainedSnapshotReader({ source, database, revision: 1 });
  const controller = new globalThis.AbortController();
  controller.abort();
  await assert.rejects(read(id, { signal: controller.signal }));
  const active = new globalThis.AbortController();
  const pending = read(id, { signal: active.signal });
  active.abort();
  await assert.rejects(pending);
  const p = project({ clock: () => 100, readSnapshot: read });
  p.select(id);
  const stale = p.refresh();
  p.select({ ...id, task: "other" });
  assert.equal(await stale, false);
  assert.equal(p.state().record, null);
  assert.equal(p.state().identity.task, "other");
});
test("bounded exporter deadline and missing inputs deny", async (t) => {
  const { database } = setup(t);
  await assert.rejects(
    createRetainedSnapshotReader({
      source,
      database,
      revision: 1,
      timeoutMs: 1,
    })(id),
  );
  await assert.rejects(
    createRetainedSnapshotReader({
      source,
      database: database + ".absent",
      revision: 1,
    })(id),
  );
});

test("actual edit/delete producer revisions map without invented observations", async (t) => {
  for (const mode of ["edit", "delete"]) {
    const { database } = setup(t, mode);
    const value = await createRetainedSnapshotReader({
      source,
      database,
      revision: 2,
    })(id);
    assert.equal(value.revision, 2);
    assert.equal(value.label, mode === "edit" ? "Updated retained text" : "");
    assert.equal(value.observedAt, null);
    assert.equal(value.authority, "unknown");
    await assert.rejects(
      createRetainedSnapshotReader({ source, database, revision: 1 })(id),
    );
  }
});
test("old evidence classes stay accepted and unknown classes rejected", () => {
  for (const evidenceClass of [
    "synthetic_component",
    "isolated_integration",
    "live_acceptance",
    "retained_local",
    "invented",
  ]) {
    const p = project({ clock: () => 100 });
    p.select(id);
    assert.equal(
      p.merge(
        {
          version: 1,
          identity: id,
          revision: 1,
          observedAt: null,
          connection: "unknown",
          authority: "unknown",
          label: "",
          simulated: false,
          evidenceClass,
        },
        { snapshot: true },
      ),
      evidenceClass !== "invented",
    );
    assert.equal(p.state().canExecute, false);
  }
});
test("deliberate pin-check mutation is caught by behavioral assertion", (t) => {
  const root = mkdtempSync(join(tmpdir(), "retained-mutant-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "dependencies"));
  writeFileSync(
    join(root, "dependencies/tether-snapshot.json"),
    JSON.stringify({ commit: pin }),
  );
  const text = readFileSync(
    new URL("../src/retained-snapshot.js", import.meta.url),
    "utf8",
  );
  assert.equal(text.split("frame.source === PIN &&").length, 2);
  writeFileSync(
    join(root, "src/mutant.mjs"),
    text.replace("frame.source === PIN &&", ""),
  );
  const v = frames();
  v[0].source = "0".repeat(40);
  const script = `import assert from 'node:assert/strict'; import {createRetainedDecoder} from ${JSON.stringify("file://" + join(root, "src/mutant.mjs"))}; const d=createRetainedDecoder(${JSON.stringify(id)},1); assert.throws(()=>{d.push(Buffer.from(${JSON.stringify(wire(v).toString())}));d.finish();});`;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    { encoding: "utf8", timeout: 5000 },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing expected exception/);
});

test("retained provenance cannot claim fresh observation, authority or passive view", () => {
  const base = {
    version: 1,
    identity: id,
    revision: 1,
    observedAt: null,
    connection: "unknown",
    authority: "unknown",
    label: "",
    simulated: false,
    evidenceClass: "retained_local",
  };
  for (const change of [
    { observedAt: 100 },
    { connection: "online" },
    { authority: "agent" },
    { viewUrl: "https://example.com/" },
    { simulated: true },
  ]) {
    const p = project({ clock: () => 100 });
    p.select(id);
    assert.equal(p.merge({ ...base, ...change }, { snapshot: true }), false);
    assert.equal(p.state().canExecute, false);
  }
});
