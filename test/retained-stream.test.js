import test from "node:test";
import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRetainedStream } from "../src/retained-stream.js";
import { createRetainedHighwater } from "../src/retained-highwater.js";
import {
  createRetainedHeadReader,
  createRetainedHeadDecoder,
  createRetainedDecoder,
  createRetainedSnapshotReader,
} from "../src/retained-snapshot.js";
const source = process.env.RUNSPINDLE_RETAINED_TETHER ?? "";
const identity = { task: "task", host: "host", workspace: "workspace" };
/** @param {string} database @param {string} highwater */
function freshStream(database, highwater) {
  const code = `import {createRetainedStream} from './src/retained-stream.js';
const stream=createRetainedStream(JSON.parse(process.argv[1]));
try { console.log(JSON.stringify({accepted:await stream.connect(),state:stream.state()})); }
finally {stream.dispose();}`;
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      code,
      JSON.stringify({ source, database, identity, highwater }),
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

/** @param {string[]} args */
function python(args) {
  const p = spawnSync("python3", ["-I", "-B", ...args], {
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(p.status, 0, p.stderr);
  return p.stdout;
}
/** @param {import('node:test').TestContext} t */
function setup(t) {
  assert.ok(source, "exact Tether prerequisite required");
  const dir = mkdtempSync(join(tmpdir(), "retained-stream-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const database = join(dir, "admission.sqlite");
  /** @param {string} [mode] */
  const produce = (mode, destination = database) =>
    python([
      "test_support/retained_producer.py",
      source,
      destination,
      ...(mode ? [mode] : []),
    ]);
  produce();
  /** @param {string} statement */
  const sql = (statement) =>
    python([
      "-c",
      "import sqlite3,sys,json; d=sqlite3.connect(sys.argv[1]); r=d.execute(sys.argv[2]).fetchall(); d.commit(); d.close(); print(json.dumps(r))",
      database,
      statement,
    ]);
  const hash = () =>
    createHash("sha256").update(readFileSync(database)).digest("hex");
  return { source, database, identity, produce, sql, hash };
}
/** @param {{state:()=>{canExecute:boolean,authority:string,freshness:string,record:{observedAt:unknown,evidenceClass:string,viewUrl:unknown}|null,retained:{queued:number}}}} stream */
function historical(stream) {
  const state = stream.state();
  assert.equal(state.canExecute, false);
  assert.equal(state.authority, "unknown");
  assert.equal(state.freshness, "unknown");
  assert.ok(state.record);
  assert.equal(state.record.observedAt, null);
  assert.equal(state.record.evidenceClass, "retained_local");
  assert.equal(state.record.viewUrl, null);
  assert.equal(state.retained.queued, 0);
}
test("actual fresh-process edits and reconnect preserve SQL revision, unknown authority and file bytes", async (t) => {
  const f = setup(t);
  const stream = createRetainedStream(f);
  t.after(() => stream.dispose());
  const before = f.hash();
  assert.equal(await stream.connect(), true);
  assert.equal(f.hash(), before);
  historical(stream);
  assert.equal(stream.state().record.revision, 1);
  f.produce("edit");
  const changed = f.hash();
  assert.equal(await stream.poll(), true);
  assert.equal(
    stream.state().record.revision,
    Number(JSON.parse(f.sql("SELECT revision FROM heads"))[0][0]),
  );
  assert.equal(stream.state().record.label, "Updated retained text");
  assert.equal(f.hash(), changed);
  stream.disconnect();
  assert.equal(await stream.connect(), true);
  historical(stream);
  assert.equal(stream.state().record.revision, 2);
});
test("latest-head jumps mark gap, never claim replayed intermediate history; duplicate poll is bounded", async (t) => {
  const f = setup(t);
  const stream = createRetainedStream(f);
  t.after(() => stream.dispose());
  assert.equal(await stream.connect(), true);
  f.produce("edit-twice");
  assert.equal(await stream.poll(), true);
  assert.equal(stream.state().record.revision, 3);
  assert.equal(stream.state().record.gap, true);
  assert.equal(stream.state().retained.gap, true);
  assert.equal(stream.state().retained.history, "latest_head_only");
  assert.equal(await stream.poll(), true);
  assert.equal(stream.state().record.revision, 3);
  historical(stream);
});
test("real deletion blanks content; v1 exact reader remains revision locked", async (t) => {
  const f = setup(t);
  const stream = createRetainedStream(f);
  t.after(() => stream.dispose());
  await stream.connect();
  f.produce("delete");
  assert.equal(await stream.poll(), true);
  assert.equal(stream.state().record.label, "");
  assert.equal(stream.state().record.revision, 2);
  await assert.rejects(
    createRetainedSnapshotReader({ ...f, revision: 1 })(identity, {}),
  );
  historical(stream);
});
test("wrong identity and schema revocation reject without repair or child reuse on explicit revoke", async (t) => {
  const f = setup(t);
  const before = f.hash();
  await assert.rejects(
    createRetainedHeadReader(f)({ ...identity, host: "wrong" }, {}),
  );
  assert.equal(f.hash(), before);
  const stream = createRetainedStream(f);
  t.after(() => stream.dispose());
  await stream.connect();
  f.sql("PRAGMA user_version=999");
  const damaged = f.hash();
  assert.equal(await stream.poll(), false);
  assert.equal(stream.state().status, "error");
  assert.equal(f.hash(), damaged);
  assert.equal(await stream.connect(), false);
  stream.revoke();
  const reads = stream.state().retained.reads;
  assert.equal(await stream.connect(), false);
  assert.equal(await stream.poll(), false);
  assert.equal(stream.state().retained.reads, reads);
  assert.equal(f.hash(), damaged);
});
test("parallel polling has zero queue and at most one read; exact budget ends observation", async (t) => {
  const f = setup(t);
  const stream = createRetainedStream({ ...f, maxReads: 2 });
  t.after(() => stream.dispose());
  await stream.connect();
  const first = stream.poll();
  assert.equal(await stream.poll(), false);
  assert.equal(await first, true);
  assert.equal(stream.state().retained.reads, 2);
  assert.equal(await stream.poll(), false);
  assert.equal(stream.state().retained.reason, "read_limit");
  assert.equal(await stream.connect(), false);
});
test("cancellation fences in-flight result and uncertain cleanup; no replacement read", async (t) => {
  const f = setup(t);
  const stream = createRetainedStream(f);
  t.after(() => stream.dispose());
  await stream.connect();
  const pending = stream.poll();
  stream.revoke();
  assert.equal(await pending, false);
  assert.equal(stream.state().retained.cleanup, "unknown");
  const reads = stream.state().retained.reads;
  assert.equal(await stream.connect(), false);
  assert.equal(await stream.poll(), false);
  assert.equal(stream.state().retained.reads, reads);
});
test("hard lifetime expires even without poll; malformed bounds never start", async (t) => {
  const f = setup(t);
  const stream = createRetainedStream({ ...f, lifetimeMs: 1 });
  t.after(() => stream.dispose());
  assert.equal(await stream.connect(), false);
  assert.equal(stream.state().retained.terminal, true);
  assert.equal(stream.state().retained.reason, "lifetime_limit");
  assert.equal(await stream.connect(), false);
  assert.throws(() => createRetainedStream({ ...f, maxReads: 257 }));
  assert.throws(() => createRetainedStream({ ...f, lifetimeMs: 0 }));
});

test("v2 rejects malformed/cross-version frames; optimized exporter selects same real head", (t) => {
  const f = setup(t);
  f.produce("edit");
  const args = [
    "tools/retained_snapshot.py",
    "--source",
    source,
    "--database",
    f.database,
    "--task",
    "task",
    "--latest-head",
  ];
  const wire = python(args);
  assert.equal(python(["-O", ...args]), wire);
  const decode = createRetainedHeadDecoder(identity);
  decode.push(Buffer.from(wire));
  assert.equal(decode.finish().revision, 2);
  const exact = createRetainedDecoder(identity, 2);
  assert.throws(() => exact.push(Buffer.from(wire)));
  for (const wrong of ["0", "-1", "1.5", "9007199254740992", '"2"']) {
    const decoder = createRetainedHeadDecoder(identity);
    assert.throws(() =>
      decoder.push(
        Buffer.from(wire.replaceAll('"revision":2', '"revision":' + wrong)),
      ),
    );
  }
});

test("revision rollback guard mutation is detected against independently read SQLite head", async (t) => {
  const f = setup(t);
  f.produce("edit");
  const original = createRetainedStream(f);
  t.after(() => original.dispose());
  await original.connect();
  f.sql("UPDATE heads SET revision='1' WHERE task='task'");
  assert.equal(await original.poll(), false);
  assert.equal(await original.connect(), false);
  assert.equal(original.state().retained.reason, "unavailable");
  const directory = mkdtempSync(join(tmpdir(), "retained-mutant-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = new URL("../src/retained-stream.js", import.meta.url);
  const text = readFileSync(file, "utf8");
  const needle = "value.revision < last.revision";
  assert.equal(text.split(needle).length, 2);
  const mutant = text
    .replace(needle, "false")
    .replace(
      /from "([.][^"\n]+)"/g,
      (_all, dependency) => `from "${new URL(dependency, file).href}"`,
    );
  const path = join(directory, "mutant.mjs");
  writeFileSync(path, mutant);
  const module = await import(pathToFileURL(path).href);
  f.sql("UPDATE heads SET revision='2' WHERE task='task'");
  const bad = module.createRetainedStream(f);
  t.after(() => bad.dispose());
  assert.equal(await bad.connect(), true);
  f.sql("UPDATE heads SET revision='1' WHERE task='task'");
  assert.equal(await bad.poll(), true);
  assert.equal(
    Number(JSON.parse(f.sql("SELECT revision FROM heads"))[0][0]),
    1,
  );
  assert.equal(bad.state().record.revision, 2);
  bad.disconnect();
  assert.equal(await bad.connect(), false);
  assert.equal(bad.state().record, null); // The generic reconnect fence still rejects it.
});

test("fresh Node consumer reconnects to actual retained revision without promoting observation time", (t) => {
  const f = setup(t);
  f.produce("edit");
  const before = f.hash();
  const code = `import {createRetainedStream} from './src/retained-stream.js';
 const stream=createRetainedStream(JSON.parse(process.argv[1]));
 try { if(!await stream.connect()) throw Error('read failed'); console.log(JSON.stringify(stream.state())); }
 finally {stream.dispose();}`;
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      code,
      JSON.stringify({ source, database: f.database, identity }),
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(
    result.record.revision,
    Number(JSON.parse(f.sql("SELECT revision FROM heads"))[0][0]),
  );
  assert.equal(result.record.observedAt, null);
  assert.equal(result.authority, "unknown");
  assert.equal(result.canExecute, false);
  assert.equal(f.hash(), before);
});

test("same revision content substitution rejects without erasing prior accepted high-water record", async (t) => {
  const f = setup(t);
  const stream = createRetainedStream(f);
  t.after(() => stream.dispose());
  await stream.connect();
  f.sql(
    `UPDATE sanitized_projections SET body=replace(body,'Retained <task>','Different task')`,
  );
  const changed = f.hash();
  assert.equal(await stream.poll(), false);
  assert.equal(stream.state().status, "error");
  assert.equal(await stream.connect(), false);
  assert.equal(f.hash(), changed);
});

test("legacy decoder never admits latest-head mode through invalid revision arguments", () => {
  for (const revision of [
    null,
    undefined,
    true,
    false,
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.throws(() =>
      createRetainedDecoder(
        identity,
        /** @type {number} */ (/** @type {unknown} */ (revision)),
      ),
    );
  }
});

test("unprojected real head fails without repair; explicit reconnect accepts later producer projection", async (t) => {
  const f = setup(t);
  const stream = createRetainedStream(f);
  t.after(() => stream.dispose());
  assert.equal(await stream.connect(), true);
  f.produce("edit-unprojected");
  assert.deepEqual(JSON.parse(f.sql("SELECT revision FROM heads")), [["2"]]);
  assert.deepEqual(
    JSON.parse(
      f.sql("SELECT count(*) FROM sanitized_projections WHERE revision='2'"),
    ),
    [[0]],
  );
  const before = f.hash();
  assert.equal(await stream.poll(), false);
  assert.equal(stream.state().status, "error");
  assert.equal(stream.state().record.revision, 1);
  assert.equal(f.hash(), before);
  assert.deepEqual(
    JSON.parse(
      f.sql("SELECT count(*) FROM sanitized_projections WHERE revision='2'"),
    ),
    [[0]],
  );
  f.produce("edit");
  const projected = f.hash();
  assert.deepEqual(
    JSON.parse(
      f.sql("SELECT count(*) FROM sanitized_projections WHERE revision='2'"),
    ),
    [[1]],
  );
  assert.equal(await stream.connect(), true);
  assert.equal(stream.state().record.revision, 2);
  assert.equal(stream.state().record.label, "Updated retained text");
  historical(stream);
  assert.equal(f.hash(), projected);
});

test("durable fence survives fresh consumers and rejects actual SQLite rollback", async (t) => {
  const f = setup(t);
  const highwater = f.database + ".highwater";
  python(["tools/retained_highwater.py", highwater, "--initialize"]);
  f.produce("edit");
  const before = f.hash();
  const first = createRetainedStream({ ...f, highwater });
  t.after(() => first.dispose());
  assert.equal(await first.connect(), true);
  historical(first);
  assert.equal(first.state().retained.highwater, "local_durable");
  first.dispose();
  assert.equal(f.hash(), before);
  f.sql("UPDATE heads SET revision='1' WHERE task='task'");
  const rolledBack = f.hash();
  const next = createRetainedStream({ ...f, highwater });
  t.after(() => next.dispose());
  assert.equal(await next.connect(), false);
  assert.equal(next.state().record, null);
  assert.equal(next.state().canExecute, false);
  assert.equal(f.hash(), rolledBack);
  // A process-local-only consumer does accept the restored old source: the
  // durable fence is the independently observed distinction, not fake data.
  const unguarded = createRetainedStream(f);
  t.after(() => unguarded.dispose());
  assert.equal(await unguarded.connect(), true);
  assert.equal(unguarded.state().record.revision, 1);
});

test("blank edits and deletions at the same revision conflict before publication", async (t) => {
  const f = setup(t);
  const edited = f.database + ".edited";
  const deleted = f.database + ".deleted";
  const highwater = f.database + ".highwater";
  f.produce("edit-empty", edited);
  f.produce("delete", deleted);
  python(["tools/retained_highwater.py", highwater, "--initialize"]);
  copyFileSync(edited, f.database);
  assert.deepEqual(JSON.parse(f.sql("SELECT revision,deleted FROM heads")), [
    ["2", 0],
  ]);
  const stream = createRetainedStream({ ...f, highwater });
  t.after(() => stream.dispose());
  assert.equal(await stream.connect(), true);
  assert.equal(stream.state().record.label, "");
  copyFileSync(deleted, f.database);
  assert.deepEqual(JSON.parse(f.sql("SELECT revision,deleted FROM heads")), [
    ["2", 1],
  ]);
  const sourceHash = f.hash();
  const fenceBytes = readFileSync(highwater);
  const fresh = freshStream(f.database, highwater);
  assert.equal(fresh.accepted, false);
  assert.equal(fresh.state.record, null);
  assert.equal(fresh.state.canExecute, false);
  assert.equal(await stream.poll(), false);
  assert.equal(stream.state().status, "error");
  assert.equal(f.hash(), sourceHash);
  assert.deepEqual(readFileSync(highwater), fenceBytes);

  const deletion = createRetainedStream(f);
  t.after(() => deletion.dispose());
  assert.equal(await deletion.connect(), true);
  assert.equal(deletion.state().record.label, "");
  copyFileSync(edited, f.database);
  assert.equal(await deletion.poll(), false);
});

test("prior fence digests preserve nonempty reads and block ambiguous empty revisions", async (t) => {
  const f = setup(t);
  const highwater = f.database + ".highwater";
  python(["tools/retained_highwater.py", highwater, "--initialize"]);
  const guard = createRetainedHighwater({ ...f, highwater });
  const reader = createRetainedHeadReader(f);
  const { deleted: initialDeletion, ...legacyNonempty } =
    await reader(identity);
  assert.equal(initialDeletion, false);
  guard(legacyNonempty);
  const initial = createRetainedStream({ ...f, highwater });
  t.after(() => initial.dispose());
  assert.equal(await initial.connect(), true);
  initial.dispose();

  f.produce("edit-empty");
  const { deleted: emptyDeletion, ...legacyEmpty } = await reader(identity);
  assert.equal(emptyDeletion, false);
  assert.equal(legacyEmpty.label, "");
  guard(legacyEmpty);
  const next = createRetainedStream({ ...f, highwater });
  t.after(() => next.dispose());
  assert.equal(await next.connect(), false);
  assert.equal(next.state().record, null);
  const advanced = f.database + ".advanced";
  f.produce("edit-twice", advanced);
  copyFileSync(advanced, f.database);
  assert.equal(await next.connect(), true);
  assert.equal(next.state().record.revision, 3);
});

test("a retained deletion prevents a running stream from publishing a higher live revision", async (t) => {
  const f = setup(t);
  const alternate = f.database + ".alternate";
  f.produce("delete");
  f.produce("edit-twice", alternate);
  const stream = createRetainedStream(f);
  t.after(() => stream.dispose());
  assert.equal(await stream.connect(), true);
  assert.equal(stream.state().record.label, "");
  copyFileSync(alternate, f.database);
  assert.deepEqual(JSON.parse(f.sql("SELECT revision,deleted FROM heads")), [
    ["3", 0],
  ]);
  // Another exact reader confirms the replacement is independently valid.
  assert.equal((await createRetainedHeadReader(f)(identity)).revision, 3);
  const sourceHash = f.hash();
  assert.equal(await stream.poll(), false);
  assert.equal(stream.state().record.label, "");
  assert.equal(await stream.connect(), false);
  assert.equal(f.hash(), sourceHash);
});

test("a retained deletion fences a higher live revision in a fresh consumer", async (t) => {
  const f = setup(t);
  const alternate = f.database + ".alternate";
  const highwater = f.database + ".highwater";
  f.produce("delete");
  f.produce("edit-twice", alternate);
  python(["tools/retained_highwater.py", highwater, "--initialize"]);
  const first = createRetainedStream({ ...f, highwater });
  t.after(() => first.dispose());
  assert.equal(await first.connect(), true);
  first.dispose();
  const receipt = readFileSync(highwater);
  copyFileSync(alternate, f.database);
  const sourceHash = f.hash();
  const fresh = freshStream(f.database, highwater);
  assert.equal(fresh.accepted, false);
  assert.equal(fresh.state.record, null);
  assert.equal(fresh.state.canExecute, false);
  assert.deepEqual(readFileSync(highwater), receipt);
  assert.equal(f.hash(), sourceHash);
});

test("v1 deletion receipts fence higher revisions before and after atomic upgrade", async (t) => {
  const f = setup(t);
  const highwater = f.database + ".highwater";
  const terminal = f.database + ".terminal";
  const alternate = f.database + ".alternate";
  f.produce("delete", terminal);
  f.produce("edit-twice", alternate);
  copyFileSync(terminal, f.database);
  const record = await createRetainedHeadReader(f)(identity);
  assert.equal(record.deleted, true);
  const { commit } = JSON.parse(
    readFileSync("dependencies/tether-snapshot.json", "utf8"),
  );
  const binding = createHash("sha256")
    .update(
      JSON.stringify([
        commit,
        f.database,
        identity.task,
        identity.host,
        identity.workspace,
      ]),
    )
    .digest("hex");
  const upgrade = `import hashlib,json,sqlite3,sys
c=sqlite3.connect(sys.argv[1])
c.execute("CREATE TABLE fence (id INTEGER PRIMARY KEY CHECK(id=1), binding TEXT NOT NULL, revision INTEGER NOT NULL, digest TEXT NOT NULL)")
c.execute("PRAGMA user_version=1")
row=json.loads(sys.argv[3])
digest=hashlib.sha256(json.dumps(row,sort_keys=True,separators=(",",":")).encode()).hexdigest()
c.execute("INSERT INTO fence VALUES (1,?,?,?)",(sys.argv[2],row["revision"],digest))
c.commit()
c.close()
print(digest)`;
  const digest = python([
    "-c",
    upgrade,
    highwater,
    binding,
    JSON.stringify(record),
  ]).trim();
  const old = readFileSync(highwater);
  copyFileSync(alternate, f.database);
  assert.equal(freshStream(f.database, highwater).accepted, false);
  assert.deepEqual(readFileSync(highwater), old);
  copyFileSync(terminal, f.database);
  assert.equal(freshStream(f.database, highwater).accepted, true);
  const newRow = python([
    "-c",
    "import json,sqlite3,sys;c=sqlite3.connect(sys.argv[1]);print(json.dumps([c.execute('PRAGMA user_version').fetchone()[0],c.execute('SELECT revision,digest,deleted FROM fence').fetchone()]));c.close()",
    highwater,
  ]);
  assert.deepEqual(JSON.parse(newRow), [2, [2, digest, 1]]);
  const migrated = readFileSync(highwater);
  copyFileSync(alternate, f.database);
  assert.equal(freshStream(f.database, highwater).accepted, false);
  assert.deepEqual(readFileSync(highwater), migrated);
});
