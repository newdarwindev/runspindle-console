import test from "node:test";
import assert from "node:assert/strict";
import { createProjection } from "../src/projection.js";

/** @type {(options: any) => any} */
const project = createProjection;
const target = { task: "task-a", host: "host", workspace: "workspace" };
/** @param {Record<string, any>} [change] */
function observation(change = {}) {
  return {
    version: 1,
    identity: target,
    revision: 1,
    observedAt: 1000,
    connection: "online",
    authority: "unknown",
    evidenceClass: "synthetic_component",
    label: "Synthetic reentrancy fixture",
    simulated: true,
    viewUrl: "https://viewer.invalid/one",
    ...change,
  };
}
/** @param {Record<string, any>} [options] */
function make(options = {}) {
  const projection = project({
    clock: () => 1000,
    allowedViewOrigins: ["https://viewer.invalid"],
    ...options,
  });
  projection.select(target);
  return projection;
}
function deferred() {
  /** @type {(value: any) => void} */ let resolve = () => {};
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("refresh reserves its request before abort so the newer callback read wins", async () => {
  const first = deferred(),
    newest = deferred();
  let calls = 0;
  /** @type {Promise<boolean> | undefined} */ let reentrant;
  const projection = make({
    /** @param {any} _identity @param {{signal: AbortSignal}} options */
    readSnapshot(_identity, { signal }) {
      calls++;
      if (calls === 1) {
        signal.addEventListener("abort", () => {
          reentrant = projection.refresh();
        });
        return first.promise;
      }
      return newest.promise;
    },
  });
  const old = projection.refresh();
  const superseded = projection.refresh();
  assert.equal(
    calls,
    2,
    "superseded outer refresh must not invoke the adapter",
  );
  assert.equal(await superseded, false);
  assert.equal(projection.state().status, "loading");
  newest.resolve(observation({ revision: 3 }));
  assert.equal(await reentrant, true);
  first.resolve(observation({ revision: 10 }));
  assert.equal(await old, false);
  assert.equal(projection.state().record.revision, 3);
  projection.dispose();
});

test("selection or disposal during read abort prevents the superseded adapter call", async () => {
  for (const action of ["select", "dispose"]) {
    const first = deferred();
    const next = { ...target, task: "task-next" };
    let calls = 0;
    const projection = make({
      /** @param {any} selected @param {{signal: AbortSignal}} options */
      readSnapshot(selected, { signal }) {
        calls++;
        if (calls === 1) {
          signal.addEventListener("abort", () => {
            if (action === "select") projection.select(next);
            else projection.dispose();
          });
          return first.promise;
        }
        return observation({ identity: selected });
      },
    });
    const old = projection.refresh();
    assert.equal(await projection.refresh(), false);
    assert.equal(calls, 1, action);
    assert.equal(projection.state().status, "empty");
    assert.deepEqual(
      projection.state().identity,
      action === "select" ? next : null,
    );
    first.resolve(observation());
    assert.equal(await old, false);
    assert.equal(await projection.refresh(), action === "select");
    assert.equal(calls, action === "select" ? 2 : 1);
    projection.dispose();
  }
});

test("selection publishes new identity before callbacks and never cleans their newer resources", async () => {
  for (const trigger of ["read-abort", "view-abort"]) {
    const middle = { ...target, task: "task-b" };
    const newest = { ...target, task: "task-c" };
    const oldRead = deferred(),
      newRead = deferred();
    const oldView = deferred(),
      newView = deferred();
    /** @type {AbortSignal[]} */ const reads = [];
    /** @type {AbortSignal[]} */ const views = [];
    /** @type {Promise<boolean> | undefined} */ let reentrant;
    let oldCloses = 0,
      newCloses = 0;
    const reenter = () => {
      assert.deepEqual(projection.state().identity, middle);
      assert.equal(projection.state().status, "empty");
      projection.select(newest);
      projection.merge(observation({ identity: newest }));
      reentrant =
        trigger === "read-abort" ? projection.view() : projection.refresh();
    };
    const projection = make({
      /** @param {any} _identity @param {{signal: AbortSignal}} options */
      readSnapshot(_identity, { signal }) {
        reads.push(signal);
        if (reads.length === 1 && trigger === "read-abort")
          signal.addEventListener("abort", reenter);
        return reads.length === 1 ? oldRead.promise : newRead.promise;
      },
      /** @param {any} _request @param {{signal: AbortSignal}} options */
      openPassive(_request, { signal }) {
        views.push(signal);
        if (views.length === 1 && trigger === "view-abort")
          signal.addEventListener("abort", reenter);
        return views.length === 1 ? oldView.promise : newView.promise;
      },
    });
    projection.merge(observation());
    const viewing = projection.view();
    const reading = projection.refresh();
    projection.select(middle);
    assert.deepEqual(projection.state().identity, newest);
    assert.equal(reads[0].aborted, true);
    assert.equal(views[0].aborted, true);
    assert.equal((trigger === "read-abort" ? views : reads)[1].aborted, false);
    oldRead.resolve(observation({ revision: 99 }));
    oldView.resolve({
      close() {
        oldCloses++;
      },
    });
    assert.equal(await reading, false);
    assert.equal(await viewing, false);
    assert.equal(oldCloses, 1);
    if (trigger === "read-abort")
      newView.resolve({
        close() {
          newCloses++;
        },
      });
    else newRead.resolve(observation({ identity: newest, revision: 2 }));
    assert.equal(await reentrant, true);
    assert.equal(projection.state().status, "ready");
    projection.dispose();
    assert.equal(newCloses, trigger === "read-abort" ? 1 : 0);
  }
});

test("dispose publishes terminal state and closes a reentrant passive handle exactly once", async () => {
  const pending = deferred();
  let closes = 0,
    reads = 0,
    opens = 0;
  /** @type {Promise<boolean>[]} */ const refused = [];
  const reenter = () => {
    assert.equal(projection.state().status, "empty");
    assert.equal(projection.state().identity, null);
    assert.equal(projection.state().record, null);
    projection.dispose();
    refused.push(projection.refresh(), projection.view());
  };
  const projection = make({
    /** @param {any} _identity @param {{signal: AbortSignal}} options */
    readSnapshot(_identity, { signal }) {
      reads++;
      signal.addEventListener("abort", reenter);
      return pending.promise;
    },
    openPassive() {
      opens++;
      return {
        close() {
          closes++;
          reenter();
        },
      };
    },
  });
  projection.merge(observation());
  assert.equal(await projection.view(), true);
  const reading = projection.refresh();
  projection.dispose();
  projection.dispose();
  assert.equal(closes, 1);
  assert.equal(reads, 1);
  assert.equal(opens, 1);
  assert.deepEqual(await Promise.all(refused), [false, false, false, false]);
  pending.resolve(observation());
  assert.equal(await reading, false);
});

test("merge cleanup cannot restore ready over a callback selection or disposal", async () => {
  for (const trigger of ["view-abort", "view-close"]) {
    for (const action of ["select", "dispose"]) {
      const opened = deferred();
      const next = { ...target, task: "task-next" };
      let closes = 0;
      const reenter = () => {
        if (action === "select") projection.select(next);
        else projection.dispose();
      };
      const projection = make({
        /** @param {any} _request @param {{signal: AbortSignal}} options */
        openPassive(_request, { signal }) {
          if (trigger === "view-abort")
            signal.addEventListener("abort", reenter);
          return trigger === "view-abort"
            ? opened.promise
            : {
                close() {
                  closes++;
                  reenter();
                },
              };
        },
      });
      projection.merge(observation());
      const viewing = projection.view();
      if (trigger === "view-close") assert.equal(await viewing, true);
      assert.equal(
        projection.merge(
          observation({ revision: 2, viewUrl: "https://viewer.invalid/two" }),
        ),
        true,
      );
      assert.equal(projection.state().status, "empty");
      assert.equal(projection.state().record, null);
      assert.deepEqual(
        projection.state().identity,
        action === "select" ? next : null,
      );
      if (trigger === "view-abort") {
        opened.resolve({
          close() {
            closes++;
          },
        });
        assert.equal(await viewing, false);
      }
      assert.equal(closes, 1);
      projection.dispose();
    }
  }
});

test("refresh cannot overwrite a newer read started during merge cleanup", async () => {
  const newest = deferred();
  let reads = 0,
    closes = 0;
  /** @type {Promise<boolean> | undefined} */ let reentrant;
  const projection = make({
    readSnapshot() {
      reads++;
      return reads === 1
        ? observation({ revision: 2, viewUrl: "https://viewer.invalid/two" })
        : newest.promise;
    },
    openPassive: () => ({
      close() {
        closes++;
        reentrant = projection.refresh();
      },
    }),
  });
  projection.merge(observation());
  assert.equal(await projection.view(), true);
  assert.equal(await projection.refresh(), false);
  assert.equal(reads, 2);
  assert.equal(closes, 1);
  assert.equal(projection.state().status, "loading");
  newest.resolve(observation({ revision: 3 }));
  assert.equal(await reentrant, true);
  assert.equal(projection.state().record.revision, 3);
  assert.equal(projection.state().status, "ready");
  projection.dispose();
});

test("passive admission waits for synchronous cleanup, including nested cleanup", async () => {
  for (const trigger of ["view-abort", "view-close"]) {
    const old = deferred();
    let opens = 0,
      oldCloses = 0,
      newCloses = 0;
    /** @type {Promise<boolean>[]} */ const refused = [];
    const reenter = () => {
      refused.push(projection.view());
      projection.select(target);
      projection.merge(observation({ revision: 3 }));
      refused.push(projection.view());
    };
    const projection = make({
      /** @param {any} _request @param {{signal: AbortSignal}} options */
      openPassive(_request, { signal }) {
        opens++;
        if (opens > 1)
          return {
            close() {
              newCloses++;
            },
          };
        if (trigger === "view-abort") {
          signal.addEventListener("abort", reenter);
          return old.promise;
        }
        return {
          close() {
            oldCloses++;
            reenter();
          },
        };
      },
    });
    projection.merge(observation());
    const viewing = projection.view();
    if (trigger === "view-close") assert.equal(await viewing, true);
    projection.merge(
      observation({ revision: 2, viewUrl: "https://viewer.invalid/two" }),
    );
    assert.deepEqual(await Promise.all(refused), [false, false]);
    assert.equal(opens, 1, "cleanup must return before another passive call");
    assert.equal(projection.state().record.revision, 3);
    assert.equal(await projection.view(), true);
    assert.equal(opens, 2);
    assert.equal(await projection.view(), false);
    if (trigger === "view-abort") {
      old.resolve({
        close() {
          oldCloses++;
        },
      });
      assert.equal(await viewing, false);
    }
    assert.equal(oldCloses, 1);
    projection.dispose();
    assert.equal(newCloses, 1);
  }
});

test("late stale handle close also excludes synchronous passive reentry", async () => {
  const old = deferred();
  let opens = 0,
    closes = 0;
  /** @type {Promise<boolean> | undefined} */ let refused;
  const projection = make({
    openPassive() {
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
  projection.merge(observation());
  const viewing = projection.view();
  projection.select(target);
  projection.merge(observation({ revision: 2 }));
  old.resolve({
    close() {
      closes++;
      refused = projection.view();
    },
  });
  assert.equal(await viewing, false);
  assert.equal(await refused, false);
  assert.equal(opens, 1);
  assert.equal(closes, 1);
  assert.equal(await projection.view(), true);
  projection.dispose();
  assert.equal(closes, 2);
});
