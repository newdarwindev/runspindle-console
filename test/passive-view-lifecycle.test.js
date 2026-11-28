import test from "node:test";
import assert from "node:assert/strict";
import {
  createProjection,
  createProjectionFactory,
} from "../src/projection.js";
import { createStreamProjection } from "../src/stream.js";

/** @param {string} task */
const identity = (task) => ({ task, host: "host", workspace: "workspace" });
/** @param {Record<string, unknown>} selected @param {number} [revision] */
const observation = (selected, revision = 1) => ({
  version: 1,
  identity: selected,
  revision,
  observedAt: 1000,
  connection: "online",
  authority: "unknown",
  evidenceClass: "synthetic_component",
  label: "Synthetic passive-resource lifecycle",
  simulated: true,
  viewUrl: "https://viewer.invalid/frame",
});
function deferred() {
  /** @type {(value:any)=>void} */ let resolve = () => {};
  /** @type {(reason?:any)=>void} */ let reject = () => {};
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
/** @param {import('../src/projection.js').ProjectionOptions} [options] */
function make(options = {}) {
  return createProjection({
    clock: () => 1000,
    allowedViewOrigins: ["https://viewer.invalid"],
    ...options,
  });
}
/** @param {{select:(identity:unknown)=>void,merge:(update:any)=>boolean}} projection @param {string} task */
function select(projection, task) {
  projection.select(identity(task));
  assert.equal(projection.merge(observation(identity(task))), true);
}

// All ports below are invented, process-local fakes. No browser or network opens.
test("pending passive ownership survives repeated selection until the late handle closes", async () => {
  const old = deferred();
  let opens = 0,
    closes = 0,
    controls = 0;
  /** @type {AbortSignal[]} */ const signals = [];
  /** @type {any[]} */ const requests = [];
  const ports = {
    control() {
      controls++;
    },
    /** @param {unknown} request @param {{signal:AbortSignal}} options */
    openPassive(request, { signal }) {
      requests.push(request);
      signals.push(signal);
      opens++;
      return opens === 1
        ? old.promise
        : {
            close() {
              closes++;
            },
          };
    },
  };
  const p = make(ports);
  select(p, "task-a");
  const pending = p.view();
  const duplicate = p.view();
  assert.equal(
    opens,
    1,
    "unresolved passive ownership must prevent another open",
  );
  assert.equal(await duplicate, false);
  for (let i = 0; i < 12; i++) {
    select(p, `task-${i}`);
    assert.equal(await p.view(), false);
    assert.equal(
      opens,
      1,
      "unresolved passive ownership must prevent another open",
    );
    assert.equal(p.state().viewCleanup, "unknown");
    assert.equal(p.state().identity?.task, `task-${i}`);
    assert.equal(p.state().canExecute, false);
  }
  assert.equal(signals[0].aborted, true);
  assert.equal(closes, 0);
  old.resolve({
    close() {
      closes++;
    },
  });
  assert.equal(await pending, false);
  assert.equal(closes, 1);
  assert.equal(p.state().viewCleanup, "no_unconfirmed_close");
  assert.equal(opens, 1, "cleanup never schedules an autonomous replacement");
  assert.equal(await p.view(), true);
  assert.equal(opens, 2);
  assert.equal(requests[1].identity.task, "task-11");
  assert.ok(requests.every((request) => request.mode === "passive"));
  assert.equal(controls, 0);
  p.dispose();
  p.dispose();
  assert.equal(closes, 2);
});

test("changed view source retains a pending acquisition and closes the late handle once", async () => {
  const old = deferred();
  let opens = 0,
    closes = 0;
  const p = make({
    openPassive: () => {
      opens++;
      return old.promise;
    },
  });
  select(p, "task-a");
  const pending = p.view();
  p.merge({
    ...observation(identity("task-a"), 2),
    viewUrl: "https://viewer.invalid/revised",
  });
  assert.equal(await p.view(), false);
  assert.equal(opens, 1);
  assert.equal(p.state().viewCleanup, "unknown");
  old.resolve({
    close() {
      closes++;
    },
  });
  assert.equal(await pending, false);
  assert.equal(closes, 1);
  p.dispose();
  assert.equal(closes, 1);
});

test("rejected or malformed opens retain uncertainty even after navigation", async () => {
  const cases = [
    () => {
      throw new Error("SECRET_CANARY");
    },
    () => Promise.reject(new Error("SECRET_CANARY")),
    () => null,
    () => ({}),
    () => ({ close: "not-a-function" }),
    () => ({
      get close() {
        throw new Error("SECRET_CANARY");
      },
    }),
  ];
  for (const result of cases) {
    let opens = 0;
    const p = make({
      openPassive: () => {
        opens++;
        return result();
      },
    });
    select(p, "task-a");
    assert.equal(await p.view(), false);
    assert.equal(p.state().viewCleanup, "unknown");
    select(p, "task-b");
    assert.equal(await p.view(), false);
    assert.equal(opens, 1, "uncertain passive acquisition must block retries");
    assert.equal(p.state().canExecute, false);
    assert.ok(!JSON.stringify(p.state()).includes("SECRET_CANARY"));
    p.dispose();
    assert.equal(p.state().viewCleanup, "unknown");
  }
});

test("late rejection or malformed handle cannot release uncertain ownership", async () => {
  for (const outcome of ["reject", "malformed"]) {
    const old = deferred();
    let opens = 0;
    const p = make({
      openPassive: () => {
        opens++;
        return old.promise;
      },
    });
    select(p, "task-a");
    const pending = p.view();
    select(p, "task-b");
    if (outcome === "reject") old.reject(new Error("SECRET_CANARY"));
    else old.resolve({});
    assert.equal(await pending, false);
    assert.equal(p.state().viewCleanup, "unknown");
    assert.equal(await p.view(), false);
    assert.equal(opens, 1, "uncertain passive acquisition must block retries");
    p.dispose();
  }
});

test("failed or non-void close blocks later admission and never infers confirmation", async () => {
  const outcomes = [
    () => {
      throw new Error("SECRET_CANARY");
    },
    () => Promise.resolve(),
    () => Promise.reject(new Error("SECRET_CANARY")),
    () => true,
  ];
  for (const outcome of outcomes) {
    for (const late of [false, true]) {
      const old = deferred();
      let opens = 0,
        closes = 0;
      const handle = {
        close() {
          assert.equal(this, handle);
          closes++;
          return outcome();
        },
      };
      const p = make({
        openPassive: () => {
          opens++;
          return late ? old.promise : handle;
        },
      });
      select(p, "task-a");
      const pending = p.view();
      if (!late) assert.equal(await pending, true);
      select(p, "task-b");
      if (late) {
        old.resolve(handle);
        assert.equal(await pending, false);
      }
      assert.equal(closes, 1);
      assert.equal(p.state().viewCleanup, "unknown");
      assert.equal(await p.view(), false);
      assert.equal(opens, 1, "unconfirmed passive close must block admission");
      await Promise.resolve();
      assert.equal(p.state().viewCleanup, "unknown");
      p.dispose();
      p.dispose();
      assert.equal(closes, 1, "uncertain close is never automatically retried");
      assert.ok(!JSON.stringify(p.state()).includes("SECRET_CANARY"));
    }
  }
});

test("disposal keeps pending ownership until late cleanup and excludes close reentry", async () => {
  const old = deferred();
  let opens = 0,
    closes = 0;
  /** @type {Promise<boolean> | undefined} */ let reentrant;
  const p = make({
    openPassive: () => {
      opens++;
      return old.promise;
    },
  });
  select(p, "task-a");
  const pending = p.view();
  p.dispose();
  p.dispose();
  assert.equal(p.state().viewCleanup, "unknown");
  old.resolve({
    close() {
      closes++;
      reentrant = p.view();
      p.dispose();
    },
  });
  assert.equal(await pending, false);
  assert.equal(await reentrant, false);
  assert.equal(closes, 1);
  assert.equal(opens, 1);
  assert.equal(p.state().viewCleanup, "no_unconfirmed_close");
});

test("shared ownership is retained across stream task replacement and disconnect", async () => {
  const old = deferred();
  let opens = 0,
    closes = 0,
    subscriptions = 0;
  const stream = createStreamProjection({
    clock: () => 1000,
    allowedViewOrigins: ["https://viewer.invalid"],
    readSnapshot: (target) => observation(target),
    subscribe: () => {
      subscriptions++;
      return { close() {} };
    },
    openPassive: () => {
      opens++;
      return opens === 1
        ? old.promise
        : {
            close() {
              closes++;
            },
          };
    },
  });
  assert.equal(await stream.connect(identity("task-a")), true);
  const pending = stream.view();
  assert.equal(await stream.connect(identity("task-b")), true);
  assert.equal(stream.state().identity?.task, "task-b");
  const refused = stream.view();
  assert.equal(opens, 1, "stream replacement must preserve passive ownership");
  assert.equal(await refused, false);
  assert.equal(stream.state().viewCleanup, "unknown");
  stream.disconnect();
  assert.equal(stream.state().viewCleanup, "unknown");
  assert.equal(await stream.connect(identity("task-c")), true);
  assert.equal(await stream.view(), false);
  assert.equal(opens, 1);
  old.resolve({
    close() {
      closes++;
    },
  });
  assert.equal(await pending, false);
  assert.equal(closes, 1);
  assert.equal(stream.state().viewCleanup, "no_unconfirmed_close");
  assert.equal(await stream.view(), true);
  assert.equal(opens, 2);
  assert.equal(subscriptions, 3);
  stream.dispose();
  assert.equal(closes, 2);
});

test("stream retains failed passive cleanup after disconnect, reconnect and disposal", async () => {
  let opens = 0,
    closes = 0;
  const stream = createStreamProjection({
    clock: () => 1000,
    allowedViewOrigins: ["https://viewer.invalid"],
    readSnapshot: (target) => observation(target),
    subscribe: () => ({ close() {} }),
    openPassive: () => {
      opens++;
      return {
        close() {
          closes++;
          throw new Error("SECRET_CANARY");
        },
      };
    },
  });
  await stream.connect(identity("task-a"));
  assert.equal(await stream.view(), true);
  stream.disconnect();
  assert.equal(stream.state().viewCleanup, "unknown");
  assert.equal(await stream.connect(identity("task-b")), true);
  assert.equal(stream.state().identity?.task, "task-b");
  assert.equal(stream.state().viewCleanup, "unknown");
  assert.equal(await stream.view(), false);
  assert.equal(
    opens,
    1,
    "stream replacement must preserve cleanup uncertainty",
  );
  stream.dispose();
  assert.equal(stream.state().viewCleanup, "unknown");
  assert.equal(closes, 1);
  assert.equal(stream.state().canExecute, false);
});

test("independent ownership scopes do not block unrelated projections", async () => {
  const old = deferred();
  let independentCloses = 0;
  const group = createProjectionFactory({
    clock: () => 1000,
    allowedViewOrigins: ["https://viewer.invalid"],
    openPassive: () => old.promise,
  });
  const first = group(),
    replacement = group();
  select(first, "task-a");
  const pending = first.view();
  first.dispose();
  select(replacement, "task-b");
  assert.equal(await replacement.view(), false);
  assert.equal(group.viewCleanup(), "unknown");
  const independent = make({
    openPassive: () => ({
      close() {
        independentCloses++;
      },
    }),
  });
  select(independent, "task-other");
  assert.equal(await independent.view(), true);
  independent.dispose();
  assert.equal(independentCloses, 1);
  old.resolve({ close() {} });
  assert.equal(await pending, false);
  replacement.dispose();
});

test("final readiness clock reentry cannot report stale passive admission as successful", async () => {
  for (const action of ["select", "replace", "dispose"]) {
    let reenter = false,
      opens = 0,
      closes = 0;
    /** @type {Promise<boolean>|undefined} */ let replacement;
    const p = make({
      clock() {
        if (reenter) {
          reenter = false;
          if (action === "dispose") p.dispose();
          else {
            select(p, "task-b");
            if (action === "replace") replacement = p.view();
          }
        }
        return 1000;
      },
      openPassive() {
        opens++;
        if (opens === 1) reenter = true;
        return {
          close() {
            closes++;
          },
        };
      },
    });
    select(p, "task-a");
    assert.equal(
      await p.view(),
      false,
      "late readiness callback must fence stale admission",
    );
    assert.equal(opens, action === "replace" ? 2 : 1);
    assert.equal(closes, 1, "stale admission must not close a newer resource");
    if (action === "replace") assert.equal(await replacement, true);
    assert.equal(
      p.state().identity?.task ?? null,
      action === "dispose" ? null : "task-b",
    );
    assert.equal(p.state().viewCleanup, "no_unconfirmed_close");
    p.dispose();
    assert.equal(closes, action === "replace" ? 2 : 1);
  }
});

test("a stale clock sample cannot revoke a replacement admitted inside the callback", async () => {
  let replace = false;
  const closed = /** @type {number[]} */ ([]);
  let opens = 0;
  /** @type {Promise<boolean>|undefined} */ let replacement;
  const p = make({
    maxAgeMs: 100,
    clock() {
      if (!replace) return 1000;
      replace = false;
      select(p, "task-b");
      replacement = p.view();
      return 1101;
    },
    openPassive() {
      const id = ++opens;
      return {
        close: () => {
          closed.push(id);
        },
      };
    },
  });
  try {
    select(p, "task-a");
    assert.equal(await p.view(), true);
    replace = true;
    p.state();
    assert.equal(await replacement, true);
    assert.equal(p.state().identity?.task, "task-b");
    assert.equal(opens, 2);
    assert.deepEqual(closed, [1]);
  } finally {
    p.dispose();
  }
  assert.deepEqual(closed, [1, 2]);
});
