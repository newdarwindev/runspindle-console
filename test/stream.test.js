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

test("pending acquisition deduplicates identity and blocks repeated task switches until confirmed cleanup", async () => {
  const late = deferred();
  /** @type {any[]} */
  const subscriptions = [];
  let closes = 0,
    reads = 0,
    controls = 0,
    views = 0;
  const f = fixture({
    subscribe: (target, callbacks) => {
      subscriptions.push({ target, ...callbacks });
      return subscriptions.length === 1
        ? late.promise
        : {
            close: () => {
              closes++;
            },
          };
    },
    readSnapshot: async (target) => {
      reads++;
      return update(5, { identity: target });
    },
    control: () => controls++,
    openPassive: () => views++,
  });
  const first = f.stream.connect(identity);
  assert.equal(f.stream.connect({ ...identity }), first);
  assert.equal(f.stream.state().status, "loading");
  const next = { ...identity, task: "task-2" };
  const third = { ...identity, task: "task-3" };
  assert.equal(await f.stream.connect(next), false);
  assert.equal(await f.stream.connect(third), false);
  assert.equal(await f.stream.connect(identity), false);
  assert.equal(
    subscriptions.length,
    1,
    "only one unresolved acquisition is allowed",
  );
  assert.equal(subscriptions[0].signal.aborted, true);
  const stopped = f.stream.state();
  assert.equal(stopped.status, "unknown");
  assert.equal(stopped.subscriptionCleanup, "unknown");
  assert.deepEqual(stopped.identity, identity);
  assert.equal(stopped.record, null);
  subscriptions[0].onEvent(update(99));
  subscriptions[0].onDisconnect();
  subscriptions[0].onError(new Error("secret-canary"));
  assert.deepEqual(f.stream.state(), stopped);
  assert.equal(await f.stream.view(), false);
  late.resolve({
    close: () => {
      closes++;
    },
  });
  assert.equal(await first, false);
  assert.equal(closes, 1);
  assert.equal(reads, 0);
  assert.equal(
    subscriptions.length,
    1,
    "confirmed cleanup must not automatically reconnect",
  );
  assert.equal(
    f.stream.state().subscriptionCleanup,
    "no_unconfirmed_unsubscribe",
  );
  assert.equal(f.stream.state().status, "offline");
  assert.equal(await f.stream.connect(third), true);
  assert.equal(subscriptions.length, 2);
  assert.equal(reads, 1);
  assert.deepEqual(f.stream.state().identity, third);
  subscriptions[0].onEvent(update(100));
  subscriptions[0].onDisconnect();
  subscriptions[0].onError();
  assert.equal(f.stream.state().record.revision, 5);
  assert.equal(f.stream.state().status, "ready");
  assert.equal(f.stream.state().canExecute, false);
  assert.equal(controls, 0);
  assert.equal(views, 0);
  f.stream.dispose();
  assert.equal(closes, 2);
});

test("disconnect and dispose retain pending acquisition until its late handle closes once", async () => {
  for (const operation of ["disconnect", "dispose"]) {
    const late = deferred();
    let calls = 0,
      closes = 0,
      reads = 0;
    /** @type {import('../src/stream.js').Callbacks | undefined} */ let callbacks;
    /** @type {Promise<boolean> | undefined} */ let duringClose;
    const f = fixture({
      subscribe: (_target, events) => {
        calls++;
        callbacks = events;
        return calls === 1
          ? late.promise
          : {
              close: () => {
                closes++;
              },
            };
      },
      readSnapshot: async () => {
        reads++;
        return update();
      },
    });
    const first = f.stream.connect(identity);
    if (operation === "disconnect") {
      f.stream.disconnect();
      f.stream.disconnect();
    } else {
      f.stream.dispose();
      f.stream.dispose();
    }
    assert.ok(callbacks);
    assert.equal(callbacks.signal.aborted, true);
    assert.equal(await f.stream.connect(identity), false);
    assert.equal(
      await f.stream.connect({ ...identity, task: "task-2" }),
      false,
    );
    assert.equal(calls, 1);
    assert.equal(f.stream.state().subscriptionCleanup, "unknown");
    assert.equal(f.stream.state().status, "unknown");
    callbacks.onEvent(update(9));
    callbacks.onDisconnect();
    callbacks.onError();
    assert.equal(f.stream.state().record, null);
    late.resolve({
      close: () => {
        closes++;
        // Even a reentrant request cannot run before close returns confirmation.
        duringClose = f.stream.connect(identity);
      },
    });
    assert.equal(await first, false);
    assert.equal(await duringClose, false);
    assert.equal(closes, 1);
    assert.equal(calls, 1);
    assert.equal(reads, 0);
    assert.equal(
      f.stream.state().subscriptionCleanup,
      "no_unconfirmed_unsubscribe",
    );
    if (operation === "disconnect") {
      assert.equal(await f.stream.connect(identity), true);
      assert.equal(calls, 2);
      assert.equal(reads, 1);
    } else {
      assert.equal(await f.stream.connect(identity), false);
      assert.equal(calls, 1);
    }
    f.stream.disconnect();
    f.stream.dispose();
    assert.equal(await f.stream.connect(identity), false);
    assert.equal(closes, operation === "disconnect" ? 2 : 1);
  }
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

test("late rejection, malformed handles and unconfirmed close permanently block acquisition", async () => {
  for (const outcome of [
    "reject",
    "missing",
    "null",
    "malformed",
    "bad-close",
    "throw",
    "async",
    "async-reject",
    "thenable",
  ]) {
    const late = deferred();
    let calls = 0,
      closes = 0,
      reads = 0,
      controls = 0;
    const f = fixture({
      subscribe: () => {
        calls++;
        return late.promise;
      },
      readSnapshot: async () => {
        reads++;
        return update();
      },
      control: () => controls++,
    });
    const first = f.stream.connect(identity);
    assert.equal(
      await f.stream.connect({ ...identity, task: "task-2" }),
      false,
    );
    assert.equal(calls, 1);
    if (outcome === "reject") late.reject(new Error("secret-canary"));
    else if (outcome === "missing") late.resolve(undefined);
    else if (outcome === "null") late.resolve(null);
    else if (outcome === "malformed") late.resolve({});
    else if (outcome === "bad-close") late.resolve({ close: "not a function" });
    else
      late.resolve({
        close: () => {
          closes++;
          if (outcome === "throw") throw new Error("secret-canary");
          if (outcome === "async") return Promise.resolve();
          if (outcome === "async-reject")
            return Promise.reject(new Error("secret-canary"));
          return { then() {} };
        },
      });
    assert.equal(await first, false);
    await Promise.resolve();
    assert.equal(f.stream.state().status, "unknown", outcome);
    assert.equal(f.stream.state().subscriptionCleanup, "unknown", outcome);
    assert.equal(await f.stream.connect(identity), false);
    assert.equal(
      await f.stream.connect({ ...identity, task: "task-3" }),
      false,
    );
    assert.equal(calls, 1);
    assert.equal(reads, 0);
    assert.equal(await f.stream.view(), false);
    assert.equal(controls, 0);
    assert.doesNotMatch(JSON.stringify(f.stream.state()), /secret-canary/);
    f.stream.disconnect();
    f.stream.dispose();
    assert.equal(
      closes,
      ["throw", "async", "async-reject", "thenable"].includes(outcome) ? 1 : 0,
    );
  }
});

test("abort, passive cleanup and close callbacks cannot acquire until teardown confirms cleanup", async () => {
  for (const trigger of ["abort", "passive-close", "subscription-close"]) {
    let calls = 0,
      allocated = 0,
      peak = 0,
      closes = 0,
      controls = 0;
    /** @type {Promise<boolean> | undefined} */ let attempted;
    const third = { ...identity, task: "task-3" };
    const reenter = () => {
      attempted = f.stream.connect(third);
      assert.equal(
        calls,
        1,
        "teardown must finish before another subscribe call",
      );
      assert.equal(f.stream.state().subscriptionCleanup, "unknown");
      assert.equal(f.stream.state().status, "unknown");
    };
    const f = fixture({
      subscribe: (_target, callbacks) => {
        calls++;
        allocated++;
        peak = Math.max(peak, allocated);
        if (calls === 1 && trigger === "abort")
          callbacks.signal.addEventListener("abort", reenter);
        let closed = false;
        return {
          close: () => {
            assert.equal(closed, false, "each handle closes once");
            closed = true;
            if (calls === 1 && trigger === "subscription-close") reenter();
            allocated--;
            closes++;
          },
        };
      },
      readSnapshot: async (target) => update(1, { identity: target }),
      openPassive: async () => ({ close: reenter }),
      control: () => controls++,
    });
    assert.equal(await f.stream.connect(identity), true);
    if (trigger === "passive-close") assert.equal(await f.stream.view(), true);
    const next = { ...identity, task: "task-2" };
    assert.equal(await f.stream.connect(next), true);
    assert.equal(await attempted, false);
    assert.equal(peak, 1, "replacement cannot overlap allocated subscription");
    assert.equal(calls, 2);
    assert.equal(closes, 1);
    assert.equal(allocated, 1);
    assert.deepEqual(f.stream.state().identity, next);
    assert.equal(f.stream.state().status, "ready");
    assert.equal(
      f.stream.state().subscriptionCleanup,
      "no_unconfirmed_unsubscribe",
    );
    assert.equal(f.stream.state().canExecute, false);
    assert.equal(controls, 0);
    f.stream.dispose();
    assert.equal(closes, 2);
    assert.equal(allocated, 0);
  }
});

test("dispose from abort or cleanup callbacks prevents the outer replacement acquisition", async () => {
  for (const trigger of ["abort", "passive-close", "subscription-close"]) {
    let calls = 0,
      closes = 0;
    const dispose = () => f.stream.dispose();
    const f = fixture({
      subscribe: (_target, callbacks) => {
        calls++;
        if (trigger === "abort")
          callbacks.signal.addEventListener("abort", dispose);
        return {
          close: () => {
            if (trigger === "subscription-close") dispose();
            closes++;
          },
        };
      },
      openPassive: async () => ({ close: dispose }),
    });
    assert.equal(await f.stream.connect(identity), true);
    if (trigger === "passive-close") assert.equal(await f.stream.view(), true);
    assert.equal(
      await f.stream.connect({ ...identity, task: "task-2" }),
      false,
    );
    assert.equal(
      calls,
      1,
      "reentrant disposal must prevent the outer replacement subscribe call",
    );
    assert.equal(closes, 1);
    assert.equal(await f.stream.connect(identity), false);
    assert.equal(await f.stream.view(), false);
    assert.equal(
      f.stream.state().subscriptionCleanup,
      "no_unconfirmed_unsubscribe",
    );
    f.stream.disconnect();
    f.stream.dispose();
    assert.equal(closes, 1);
  }
});

test("conflicting current revision and regressed source clock close a ready stream", async () => {
  for (const changed of [
    update(1, { label: "changed" }),
    update(2, { observedAt: 999 }),
  ]) {
    let viewsClosed = 0;
    const f = fixture({
      openPassive: async () => ({
        close() {
          viewsClosed++;
        },
      }),
    });
    assert.equal(await f.stream.connect(identity), true);
    assert.equal(await f.stream.view(), true);
    f.subscriptions[0].onEvent(changed);
    assert.equal(f.stream.state().status, "unknown");
    assert.equal(f.stream.state().record.label, "synthetic");
    assert.equal(f.closes(), 1);
    assert.equal(viewsClosed, 1);
    assert.equal(await f.stream.view(), false);
    f.subscriptions[0].onEvent(update(3));
    assert.equal(f.stream.state().status, "unknown");
    f.stream.dispose();
  }
});

test("same-revision buffered conflicts reject snapshot synchronization", async () => {
  const pending = deferred();
  const f = fixture({ readSnapshot: () => pending.promise });
  const result = f.stream.connect(identity);
  f.subscriptions[0].onEvent(update(1, { authority: "human" }));
  pending.resolve(update(1));
  assert.equal(await result, false);
  assert.equal(f.stream.state().status, "unknown");
  assert.equal(f.stream.state().authority, "denied");
  assert.equal(f.stream.state().buffered, 0);
  assert.equal(f.closes(), 1);
  f.stream.dispose();
});

test("identical duplicates and older observations remain harmless", async () => {
  const f = fixture();
  assert.equal(await f.stream.connect(identity), true);
  f.subscriptions[0].onEvent(update(1));
  f.subscriptions[0].onEvent(update(0, { label: "old" }));
  assert.equal(f.stream.state().status, "ready");
  assert.equal(f.stream.state().record.revision, 1);
  assert.equal(f.closes(), 0);
  f.stream.dispose();
});

test("conflict checking contains clock failures and navigation reentrancy", async () => {
  for (const kind of ["throw", "disconnect"]) {
    let calls = 0;
    let armed = false;
    const f = fixture({
      clock() {
        if (armed && ++calls === 2) {
          if (kind === "throw") throw new Error("private-clock-diagnostic");
          f.stream.disconnect();
        }
        return 1000;
      },
    });
    assert.equal(await f.stream.connect(identity), true);
    armed = true;
    assert.doesNotThrow(() => f.subscriptions[0].onEvent(update(2)));
    armed = false;
    assert.equal(f.stream.state().record.revision, 1);
    assert.notEqual(f.stream.state().status, "ready");
    assert.equal(f.closes(), 1);
    f.stream.dispose();
  }
});

for (const outcome of ["return", "throw"]) {
  test(`state read preserves replacement after the old clock callback can ${outcome}`, async () => {
    const next = { ...identity, task: "task-2" };
    const snapshot = deferred();
    let armed = false;
    let replacement = Promise.resolve(false);
    let viewCalls = 0;
    const f = fixture({
      clock() {
        if (armed) {
          armed = false;
          replacement = f.stream.connect(next);
          if (outcome === "throw") throw new Error("private-clock-diagnostic");
        }
        return 1000;
      },
      readSnapshot: (target) =>
        target.task === next.task
          ? snapshot.promise
          : Promise.resolve(update()),
      openPassive() {
        viewCalls++;
        return { close() {} };
      },
    });
    try {
      assert.equal(await f.stream.connect(identity), true);
      armed = true;
      const loading = f.stream.state();
      assert.equal(loading.status, "loading");
      assert.deepEqual(loading.identity, next);
      assert.equal(loading.record, null);
      assert.equal(loading.freshness, "unknown");
      assert.equal(loading.canExecute, false);
      assert.equal(f.subscriptions.length, 2);
      assert.equal(f.subscriptions[0].signal.aborted, true);
      assert.equal(f.subscriptions[1].signal.aborted, false);
      assert.equal(f.closes(), 1);
      assert.equal(await f.stream.view(), false);
      assert.equal(viewCalls, 0);

      snapshot.resolve(update(4, { identity: next }));
      assert.equal(await replacement, true);
      const ready = f.stream.state();
      assert.equal(ready.status, "ready");
      assert.deepEqual(ready.identity, next);
      assert.equal(ready.record.revision, 4);
      assert.equal(f.closes(), 1);
    } finally {
      f.stream.dispose();
    }
    assert.equal(f.closes(), 2);
  });
}

test("reconnect rejects older, conflicting and empty snapshots without exposing a passive view", async () => {
  /** @type {ReturnType<typeof update> | null} */
  let snapshot = update(4);
  let viewCalls = 0;
  const f = fixture({
    readSnapshot: async () => snapshot,
    openPassive() {
      viewCalls++;
      return { close() {} };
    },
  });
  assert.equal(await f.stream.connect(identity), true);
  f.subscriptions[0].onEvent(update(5));
  for (const rejected of [update(4), update(5, { label: "changed" }), null]) {
    f.stream.disconnect();
    snapshot = rejected;
    // Optional fields with undefined represent the same complete identity.
    const connected = await f.stream.connect({ ...identity, trace: undefined });
    assert.equal(
      await f.stream.view(),
      false,
      "replayed snapshot must not open a passive view",
    );
    assert.equal(connected, false);
    assert.equal(f.stream.state().status, "unknown");
    assert.equal(f.stream.state().record, null);
  }
  assert.equal(viewCalls, 0);
  assert.equal(f.closes(), 4);
  snapshot = update(6);
  assert.equal(await f.stream.connect(identity), true);
  assert.equal(f.stream.state().record.revision, 6);
  assert.equal(await f.stream.view(), true);
  assert.equal(viewCalls, 1);
  f.stream.dispose();
});

test("navigation retains each identity checkpoint and a missing clock cannot erase its timestamp", async () => {
  const other = { ...identity, nativeSession: "other-session" };
  let snapshot = 4;
  let timestamp = 1000;
  const f = fixture({
    readSnapshot: async (target) =>
      update(snapshot, { identity: target, observedAt: timestamp }),
  });
  assert.equal(await f.stream.connect(identity), true);
  f.subscriptions[0].onEvent(update(5, { observedAt: null }));
  assert.equal(f.stream.state().freshness, "unknown");
  snapshot = 1;
  assert.equal(await f.stream.connect(other), true);
  assert.deepEqual(f.stream.state().identity, other);
  snapshot = 6;
  timestamp = 999;
  assert.equal(await f.stream.connect(identity), false);
  assert.equal(f.stream.state().status, "unknown");
  assert.deepEqual(f.stream.state().identity, identity);
  timestamp = 1000;
  assert.equal(await f.stream.connect(identity), true);
  assert.equal(f.stream.state().record.revision, 6);
  f.stream.dispose();
});

test("a sequence gap releases the current passive viewer until a complete snapshot", async () => {
  let snapshot = 1;
  let viewCalls = 0;
  let viewCloses = 0;
  const f = fixture({
    readSnapshot: async () => update(snapshot),
    openPassive() {
      viewCalls++;
      return {
        close: () => {
          viewCloses++;
        },
      };
    },
  });
  assert.equal(await f.stream.connect(identity), true);
  assert.equal(await f.stream.view(), true);
  f.subscriptions[0].onEvent(update(3));
  assert.equal(viewCloses, 1);
  assert.equal(f.stream.state().record.gap, true);
  assert.equal(await f.stream.view(), false);
  assert.equal(viewCalls, 1);
  f.stream.disconnect();
  snapshot = 3;
  assert.equal(await f.stream.connect(identity), true);
  assert.equal(f.stream.state().record.gap, false);
  assert.equal(await f.stream.view(), true);
  f.stream.dispose();
  assert.equal(viewCloses, 2);
});

test("identity capacity refuses new subscriptions without evicting prior checkpoints", async () => {
  let revision = 2;
  const f = fixture({
    readSnapshot: async (target) => update(revision, { identity: target }),
  });
  for (let index = 0; index < 128; index++) {
    assert.equal(
      await f.stream.connect({ ...identity, task: `task-${index}` }),
      true,
    );
  }
  assert.equal(
    await f.stream.connect({ ...identity, task: "overflow" }),
    false,
  );
  assert.equal(f.subscriptions.length, 128);
  revision = 1;
  assert.equal(await f.stream.connect(identity), false);
  assert.equal(f.stream.state().status, "unknown");
  assert.equal(f.subscriptions.length, 129);
  f.stream.dispose();
});
