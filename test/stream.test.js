import test from "node:test";
import assert from "node:assert/strict";
import { createStreamProjection } from "../src/stream.js";
const identity = { task: "task-1", host: "host-1", workspace: "workspace-1" };
/** @param {number} revision @param {Record<string, any>} change */
const update = (revision = 1, change = {}) => ({
  version: 1,
  identity,
  revision,
  observedAt: 1000,
  connection: "online",
  authority: "denied",
  evidenceClass: "synthetic_component",
  label: "synthetic",
  simulated: true,
  viewUrl: "https://viewer.invalid/frame",
  ...change,
});
const deferred = () => {
  /** @type {(value: any) => void} */ let resolve = () => {};
  /** @type {(error: unknown) => void} */ let reject = () => {};
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
/** @param {Partial<import('../src/stream.js').StreamOptions> & {control?: () => void}} overrides */
function fixture(overrides = {}) {
  /** @type {any[]} */
  const subscriptions = [];
  let closes = 0;
  const stream = createStreamProjection({
    clock: () => 1000,
    allowedViewOrigins: ["https://viewer.invalid"],
    readSnapshot: async () => update(),
    subscribe: async (target, callbacks) => {
      subscriptions.push({ target, ...callbacks });
      return {
        close() {
          closes++;
        },
      };
    },
    ...overrides,
  });
  return { stream, subscriptions, closes: () => closes };
}

test("subscribe precedes snapshot; buffered events cannot regress revisions", async () => {
  const pending = deferred();
  const f = fixture({ readSnapshot: () => pending.promise });
  const connected = f.stream.connect(identity);
  assert.equal(
    f.stream.connect({
      workspace: "workspace-1",
      host: "host-1",
      task: "task-1",
    }),
    connected,
  );
  f.subscriptions[0].onEvent(update(3));
  f.subscriptions[0].onEvent(update(2));
  assert.equal(f.stream.state().status, "loading");
  pending.resolve(update(2));
  assert.equal(await connected, true);
  assert.equal(f.stream.state().record.revision, 3);
  assert.equal(f.stream.state().status, "ready");
  assert.equal(f.subscriptions.length, 1);
  f.stream.dispose();
  assert.equal(f.closes(), 1);
});

test("reconnect fences old stream and late snapshot across navigation", async () => {
  const pending = deferred();
  let reads = 0;
  const f = fixture({
    readSnapshot: (target) =>
      ++reads === 1
        ? pending.promise
        : Promise.resolve(update(1, { identity: target })),
  });
  const first = f.stream.connect(identity);
  await Promise.resolve();
  const next = { ...identity, task: "task-2" };
  assert.equal(await f.stream.connect(next), true);
  pending.resolve(update(20));
  assert.equal(await first, false);
  f.subscriptions[0].onEvent(update(30));
  f.subscriptions[0].onDisconnect();
  assert.deepEqual(f.stream.state().identity, next);
  assert.equal(f.stream.state().record.revision, 1);
  assert.equal(f.stream.state().status, "ready");
  assert.equal(f.subscriptions[0].signal.aborted, true);
  f.stream.dispose();
  assert.equal(f.closes(), 2);
});

test("disconnect during snapshot cannot restore readiness; reconnect gets a new snapshot", async () => {
  const pending = deferred();
  let reads = 0;
  const f = fixture({
    readSnapshot: () =>
      ++reads === 1 ? pending.promise : Promise.resolve(update(5)),
  });
  const first = f.stream.connect(identity);
  await Promise.resolve();
  f.subscriptions[0].onDisconnect();
  pending.resolve(update());
  assert.equal(await first, false);
  assert.equal(f.stream.state().status, "offline");
  assert.equal(await f.stream.connect(identity), true);
  assert.equal(f.stream.state().record.revision, 5);
  f.stream.dispose();
});

test("overflow fails closed, discards buffered object graphs and closes late handles", async () => {
  const pending = deferred();
  let closes = 0;
  const f = fixture({
    maxBuffered: 1,
    subscribe: (_target, events) => {
      events.onEvent(
        update(1, { ignored: new Array(1000).fill("not retained") }),
      );
      events.onEvent(update(2));
      return pending.promise;
    },
  });
  const result = f.stream.connect(identity);
  assert.equal(f.stream.state().status, "unknown");
  assert.equal(f.stream.state().buffered, 0);
  pending.resolve({
    close() {
      closes++;
    },
  });
  assert.equal(await result, false);
  assert.equal(closes, 1);
});

test("wrong identities and malformed observations become unknown without control calls", async () => {
  for (const change of [
    { identity: { ...identity, host: "wrong" } },
    { version: 2 },
    { observedAt: undefined },
  ]) {
    let controls = 0;
    const f = fixture({ control: () => controls++ });
    await f.stream.connect(identity);
    f.subscriptions[0].onEvent(update(2, change));
    assert.equal(f.stream.state().status, "unknown");
    assert.equal(await f.stream.view(), false);
    assert.equal(f.closes(), 1);
    assert.equal(controls, 0);
    f.stream.dispose();
  }
});

test("gaps stay unknown until resubscription snapshot, duplicates cannot forge authority", async () => {
  let snapshot = 1;
  const f = fixture({ readSnapshot: async () => update(snapshot) });
  await f.stream.connect(identity);
  f.subscriptions[0].onEvent(update(3));
  f.subscriptions[0].onEvent(update(3, { authority: "agent" }));
  assert.equal(f.stream.state().status, "unknown");
  assert.equal(f.stream.state().authority, "denied");
  f.stream.disconnect();
  snapshot = 4;
  await f.stream.connect(identity);
  assert.equal(f.stream.state().status, "ready");
  assert.equal(f.stream.state().canExecute, false);
  f.stream.dispose();
});

test("passive views are closed on disconnect; no raw errors are displayed", async () => {
  let opens = 0;
  let closes = 0;
  const f = fixture({
    openPassive: async ({ mode }) => {
      assert.equal(mode, "passive");
      opens++;
      return {
        close() {
          closes++;
        },
      };
    },
  });
  await f.stream.connect(identity);
  assert.equal(await f.stream.view(), true);
  f.subscriptions[0].onError(new Error("secret-canary-untrusted"));
  assert.equal(f.stream.state().status, "error");
  assert.equal(closes, 1);
  assert.equal(await f.stream.view(), false);
  assert.equal(opens, 1);
  assert.doesNotMatch(JSON.stringify(f.stream.state()), /secret-canary/);
  f.stream.dispose();
});

test("failed unsubscribe blocks new subscriptions and never reports confirmed cleanup", async () => {
  let calls = 0;
  const f = fixture({
    subscribe: async () => {
      calls++;
      return {
        close() {
          throw new Error("secret-canary");
        },
      };
    },
  });
  await f.stream.connect(identity);
  f.stream.disconnect();
  assert.equal(f.stream.state().subscriptionCleanup, "unknown");
  assert.equal(f.stream.state().status, "unknown");
  assert.equal(await f.stream.connect({ ...identity, task: "task-2" }), false);
  assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(f.stream.state()), /secret-canary/);
});

test("absent adapters and missing clock fail explicitly; disposal cannot reconnect", async () => {
  assert.throws(
    () => createStreamProjection(/** @type {any} */ (undefined)),
    TypeError,
  );
  const stream = createStreamProjection({ clock: () => 1000 });
  assert.equal(await stream.connect(identity), false);
  assert.equal(stream.state().status, "unsupported");
  stream.dispose();
  assert.equal(await stream.connect(identity), false);
  assert.throws(() => fixture({ maxBuffered: 0 }), TypeError);
});

test("late unsubscribe failure makes a newer subscription unknown and closes it", async () => {
  const late = deferred();
  let count = 0;
  let currentCloses = 0;
  const f = fixture({
    subscribe: async () =>
      ++count === 1
        ? late.promise
        : {
            close() {
              currentCloses++;
            },
          },
  });
  const first = f.stream.connect(identity);
  const next = { ...identity, task: "task-2" };
  await f.stream.connect(next);
  late.resolve({
    close() {
      throw new Error("unconfirmed old unsubscribe");
    },
  });
  assert.equal(await first, false);
  assert.equal(f.stream.state().status, "unknown");
  assert.equal(f.stream.state().subscriptionCleanup, "unknown");
  assert.equal(currentCloses, 1);
  assert.equal(await f.stream.connect(identity), false);
});

test("buffer overflow assertion detects a deliberately disabled bound", async () => {
  const { mkdtempSync, readFileSync, writeFileSync, rmSync } = await import(
    "node:fs"
  );
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const { pathToFileURL } = await import("node:url");
  const root = mkdtempSync(join(tmpdir(), "console-stream-mutation-"));
  try {
    const source = readFileSync(
      new URL("../src/stream.js", import.meta.url),
      "utf8",
    );
    const anchor = "session.buffer.length >= maxBuffered";
    assert.equal(source.split(anchor).length, 2);
    writeFileSync(join(root, "package.json"), '{"type":"module"}');
    writeFileSync(
      join(root, "projection.js"),
      readFileSync(new URL("../src/projection.js", import.meta.url)),
    );
    writeFileSync(join(root, "stream.js"), source.replace(anchor, "false"));
    const script = `import assert from 'node:assert/strict';
import {createStreamProjection} from ${JSON.stringify(pathToFileURL(join(root, "stream.js")).href)};
const identity=${JSON.stringify(identity)}, event=${JSON.stringify(update())};
const stream=createStreamProjection({clock:()=>1000,maxBuffered:1,readSnapshot:async()=>event,
subscribe:(_identity,c)=>{c.onEvent(event);c.onEvent({...event,revision:2});return new Promise(()=>{});}});
stream.connect(identity);assert.equal(stream.state().status,'unknown','overflow must never stay loading');`;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      { encoding: "utf8", timeout: 15000 },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /AssertionError/);
    assert.match(result.stderr, /overflow must never stay loading/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("subscription failure without a handle leaves cleanup unknown", async () => {
  let calls = 0;
  const f = fixture({
    subscribe: async () => {
      calls++;
      throw new Error("secret-canary");
    },
  });
  assert.equal(await f.stream.connect(identity), false);
  assert.equal(f.stream.state().subscriptionCleanup, "unknown");
  assert.equal(await f.stream.connect(identity), false);
  assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(f.stream.state()), /secret-canary/);
});

test("clock failure never prevents teardown during disconnect navigation or disposal", async () => {
  for (const operation of ["disconnect", "connect", "dispose", "state"]) {
    let broken = false;
    const f = fixture({
      clock: () => {
        if (broken) throw new Error("secret-canary-clock");
        return 1000;
      },
    });
    await f.stream.connect(identity);
    broken = true;
    if (operation === "connect")
      assert.equal(
        await f.stream.connect({ ...identity, task: "task-2" }),
        false,
      );
    else if (operation === "disconnect") f.stream.disconnect();
    else if (operation === "dispose") f.stream.dispose();
    else f.stream.state();
    assert.equal(f.closes(), 1);
    assert.equal(f.subscriptions[0].signal.aborted, true);
    assert.equal(f.stream.state().status, "unknown");
    assert.doesNotMatch(JSON.stringify(f.stream.state()), /secret-canary/);
    f.stream.dispose();
    assert.equal(f.closes(), 1);
  }
});

test("late subscription rejection also tears down a newer known subscription", async () => {
  const late = deferred();
  let calls = 0;
  let closes = 0;
  const f = fixture({
    subscribe: async () =>
      ++calls === 1
        ? late.promise
        : {
            close() {
              closes++;
            },
          },
  });
  const first = f.stream.connect(identity);
  await f.stream.connect({ ...identity, task: "task-2" });
  late.reject(new Error("secret-canary"));
  assert.equal(await first, false);
  assert.equal(f.stream.state().status, "unknown");
  assert.equal(f.stream.state().subscriptionCleanup, "unknown");
  assert.equal(f.subscriptions.length, 0);
  assert.equal(closes, 1);
  assert.equal(await f.stream.connect(identity), false);
});
