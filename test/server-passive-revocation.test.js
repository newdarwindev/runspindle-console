/* global fetch */
import assert from "node:assert/strict";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import {
  createProjection,
  createServerRevocationHandle,
} from "../src/projection.js";
import { createStreamProjection } from "../src/stream.js";

const issuerKey = "synthetic-loopback-close-issuer";
const binding = Object.freeze({ viewId: "view-1", admissionId: "admission-1" });

function gate() {
  /** @type {() => void} */
  let resolve = () => {};
  const promise = new Promise((done) => {
    resolve = () => done(undefined);
  });
  return { promise, resolve };
}

/** @param {{viewId:string,admissionId:string}} target */
function signature(target) {
  return createHmac("sha256", issuerKey)
    .update(JSON.stringify([target.viewId, target.admissionId, "revoked"]))
    .digest("hex");
}

/** @param {string} task */
function observation(task) {
  return {
    version: 1,
    identity: { task, host: "host", workspace: "workspace" },
    revision: 1,
    observedAt: 1000,
    connection: "online",
    authority: "agent",
    evidenceClass: "synthetic_component",
    label: "Synthetic preview",
    simulated: true,
    viewUrl: "https://viewer.invalid/passive",
  };
}

/** @param {import('../src/projection.js').ProjectionOptions['openPassive']} openPassive @param {number} [viewOpenTimeoutMs] */
function projection(openPassive, viewOpenTimeoutMs) {
  return createProjection({
    clock: () => 1000,
    openPassive,
    viewOpenTimeoutMs,
    allowedViewOrigins: ["https://viewer.invalid"],
  });
}

/** @param {{select:(identity:unknown)=>void, merge:(update:unknown)=>boolean}} value @param {string} task */
function select(value, task) {
  const update = observation(task);
  value.select(update.identity);
  assert.equal(value.merge(update), true);
}

/** @param {()=>boolean} predicate */
async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate() && Date.now() < deadline) await setImmediate();
  assert.equal(predicate(), true, "expected revocation lifecycle transition");
}

for (const transition of ["authority change", "stale clock", "unknown clock"])
  test(
    `authenticated loopback revocation fences views after ${transition}`,
    { timeout: 10000 },
    async () => {
      const started = gate();
      const accept = gate();
      /** @type {string[]} */
      const requests = [];
      let active = false;
      const server = createServer(async (req, res) => {
        const route = req.method + " " + req.url;
        requests.push(route);
        if (route === "POST /open") {
          active = true;
          res.end(JSON.stringify(binding));
        } else if (route === "GET /passive") {
          res
            .writeHead(active ? 200 : 403)
            .end(active ? "synthetic frame" : "");
        } else if (route === "POST /revoke") {
          let data = "";
          for await (const chunk of req) data += chunk;
          const requested = JSON.parse(data);
          if (
            requested.viewId !== binding.viewId ||
            requested.admissionId !== binding.admissionId
          ) {
            res.writeHead(403).end();
            return;
          }
          started.resolve();
          await accept.promise;
          active = false;
          res.end(
            JSON.stringify({
              ...binding,
              status: "revoked",
              proof: signature(binding),
            }),
          );
        } else {
          res.writeHead(404).end();
        }
      });
      await new Promise((done) =>
        server.listen(0, "127.0.0.1", () => done(undefined)),
      );
      const address = /** @type {import('node:net').AddressInfo} */ (
        server.address()
      );
      const origin = "http://127.0.0.1:" + address.port;
      let now = 1000;
      const value = createProjection({
        allowedViewOrigins: ["https://viewer.invalid"],
        clock: () => now,
        maxAgeMs: 100,
        async openPassive(_request, { signal }) {
          const opened = await fetch(origin + "/open", {
            method: "POST",
            signal,
          });
          return createServerRevocationHandle(await opened.json(), {
            async revoke(target, { signal: closeSignal }) {
              const response = await fetch(origin + "/revoke", {
                method: "POST",
                body: JSON.stringify(target),
                signal: closeSignal,
              });
              if (!response.ok) throw Error("synthetic revocation denied");
              return response.json();
            },
            verifyReceipt(target, receipt) {
              const expected = Buffer.from(signature(target));
              const actual = Buffer.from(receipt.proof);
              return (
                expected.length === actual.length &&
                timingSafeEqual(expected, actual)
              );
            },
          });
        },
      });
      try {
        select(value, "task-a");
        assert.equal(await value.view(), true);
        assert.equal(
          await (await fetch(origin + "/passive")).text(),
          "synthetic frame",
        );
        if (transition === "authority change") {
          assert.equal(
            value.merge({
              ...observation("task-a"),
              revision: 2,
              authority: "denied",
            }),
            true,
          );
        } else {
          now = 1100;
          assert.equal(value.state().viewCleanup, "no_unconfirmed_close");
          now = transition === "stale clock" ? 1101 : Number.NaN;
          assert.equal(
            value.state().status,
            transition === "stale clock" ? "stale" : "unknown",
          );
        }
        assert.equal(value.state().viewCleanup, "unknown");
        await started.promise;
        now = 1000;
        select(value, "task-b");
        assert.equal(value.state().viewCleanup, "unknown");
        assert.equal(
          await value.view(),
          false,
          "a new view is blocked while the backend still serves",
        );
        assert.equal(active, true);
        accept.resolve();
        await until(() => value.state().viewCleanup === "no_unconfirmed_close");
        assert.equal((await fetch(origin + "/passive")).status, 403);
        assert.equal(value.state().canExecute, false);
        assert.deepEqual(requests, [
          "POST /open",
          "GET /passive",
          "POST /revoke",
          "GET /passive",
        ]);
      } finally {
        accept.resolve();
        value.dispose();
        server.closeAllConnections();
        await new Promise((done) => server.close(() => done(undefined)));
      }
    },
  );

test("late acquisition is revoked once after navigation", async () => {
  const acquired = gate();
  const revoke = gate();
  let closes = 0;
  const value = projection(async () => {
    await acquired.promise;
    return createServerRevocationHandle(binding, {
      async revoke() {
        closes++;
        await revoke.promise;
        return { ...binding, status: "revoked", proof: signature(binding) };
      },
      verifyReceipt: (target, receipt) => signature(target) === receipt.proof,
    });
  });
  select(value, "task-a");
  const opening = value.view();
  select(value, "task-b");
  assert.equal(await value.view(), false);
  acquired.resolve();
  assert.equal(await opening, false);
  assert.equal(value.state().viewCleanup, "unknown");
  assert.equal(await value.view(), false);
  revoke.resolve();
  await until(() => value.state().viewCleanup === "no_unconfirmed_close");
  assert.equal(closes, 1);
  value.dispose();
});

for (const response of [
  {
    ...binding,
    viewId: "different-view",
    status: "revoked",
    proof: signature(binding),
  },
  {
    ...binding,
    admissionId: "old-admission",
    status: "revoked",
    proof: signature(binding),
  },
  { ...binding, status: "accepted", proof: signature(binding) },
  { ...binding, status: "revoked", proof: "untrusted" },
  null,
]) {
  test(
    "bad or unverified backend receipt keeps revocation unknown: " +
      JSON.stringify(response),
    async () => {
      const attempted = gate();
      let calls = 0;
      const value = projection(() => {
        calls++;
        return createServerRevocationHandle(binding, {
          revoke() {
            attempted.resolve();
            if (response === null) throw Error("fixture request failed");
            return response;
          },
          verifyReceipt: (target, receipt) =>
            signature(target) === receipt.proof,
        });
      });
      select(value, "task-a");
      assert.equal(await value.view(), true);
      select(value, "task-b");
      await attempted.promise;
      await setImmediate();
      assert.equal(value.state().viewCleanup, "unknown");
      assert.equal(await value.view(), false);
      assert.equal(calls, 1);
      value.dispose();
    },
  );
}

test("a hung revocation is cancelled and a late acknowledgment cannot release the fence", async () => {
  const acknowledgement = gate();
  const expired = gate();
  const value = projection(() =>
    createServerRevocationHandle(binding, {
      timeoutMs: 20,
      async revoke(_target, { signal }) {
        signal.addEventListener("abort", expired.resolve, { once: true });
        await acknowledgement.promise;
        return { ...binding, status: "revoked", proof: signature(binding) };
      },
      verifyReceipt: (target, receipt) => signature(target) === receipt.proof,
    }),
  );
  select(value, "task-a");
  assert.equal(await value.view(), true);
  select(value, "task-b");
  await expired.promise;
  acknowledgement.resolve();
  await setImmediate();
  assert.equal(value.state().viewCleanup, "unknown");
  assert.equal(await value.reconcileViewCleanup(), false);
  assert.equal(await value.view(), false);
  value.dispose();
});

test(
  "authenticated readback reconciles lost revocation across stream disconnect",
  { timeout: 10000 },
  async () => {
    const readStarted = gate();
    const allowRead = gate();
    const closeReturned = gate();
    const path = "/revocation/view-1/admission-1";
    /** @type {string[]} */
    const requests = [];
    let active = true;
    const server = createServer(async (req, res) => {
      const route = req.method + " " + req.url;
      requests.push(route);
      if (route === "POST " + path) {
        active = false;
        res.destroy(); // Close committed, but the client never gets a receipt.
      } else if (route === "GET " + path) {
        readStarted.resolve();
        await allowRead.promise;
        res.end(
          JSON.stringify({
            ...binding,
            status: active ? "active" : "revoked",
            proof: signature(binding),
          }),
        );
      } else if (route === "GET /passive") {
        res.writeHead(active ? 200 : 403).end();
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise((done) =>
      server.listen(0, "127.0.0.1", () => done(undefined)),
    );
    const address = /** @type {import('node:net').AddressInfo} */ (
      server.address()
    );
    const origin = "http://127.0.0.1:" + address.port;
    let opens = 0;
    const value = createStreamProjection({
      clock: () => 1000,
      allowedViewOrigins: ["https://viewer.invalid"],
      subscribe: () => ({ close() {} }),
      readSnapshot: (/** @type {{task:string}} */ identity) =>
        observation(identity.task),
      openPassive() {
        opens++;
        return createServerRevocationHandle(binding, {
          async revoke(target, { signal }) {
            try {
              await fetch(
                origin +
                  "/revocation/" +
                  target.viewId +
                  "/" +
                  target.admissionId,
                { method: "POST", signal },
              );
              throw Error("unexpected revocation response");
            } finally {
              closeReturned.resolve();
            }
          },
          async readRevocation(target, { signal }) {
            const response = await fetch(
              origin +
                "/revocation/" +
                target.viewId +
                "/" +
                target.admissionId,
              { signal },
            );
            if (!response.ok) throw Error("synthetic readback denied");
            return response.json();
          },
          verifyReceipt: (target, receipt) =>
            signature(target) === receipt.proof,
        });
      },
    });
    try {
      assert.equal(await value.connect(observation("task-a").identity), true);
      assert.equal(await value.view(), true);
      assert.equal((await fetch(origin + "/passive")).status, 200);
      value.disconnect();
      assert.equal(await value.reconcileViewCleanup(), false);
      await closeReturned.promise;
      await setImmediate();
      assert.equal((await fetch(origin + "/passive")).status, 403);
      const readback = value.reconcileViewCleanup();
      await readStarted.promise;
      assert.equal(
        value.state().viewCleanup,
        "unknown",
        "pending readback must retain the revocation fence",
      );
      assert.equal(await value.reconcileViewCleanup(), false);
      assert.equal(await value.view(), false);
      allowRead.resolve();
      assert.equal(await readback, true);
      assert.equal(value.state().viewCleanup, "no_unconfirmed_close");
      assert.equal(await value.reconcileViewCleanup(), false);
      assert.deepEqual(requests, [
        "GET /passive",
        "POST " + path,
        "GET /passive",
        "GET " + path,
      ]);
      assert.equal(opens, 1);
      assert.equal(value.state().canExecute, false);
    } finally {
      allowRead.resolve();
      value.dispose();
      server.closeAllConnections();
      await new Promise((done) => server.close(() => done(undefined)));
    }
  },
);

test("wrong, unverified and expired readbacks cannot clear a revocation fence", async () => {
  const expired = gate();
  const late = gate();
  const closed = { ...binding, status: "revoked", proof: signature(binding) };
  let reads = 0;
  let revocations = 0;
  let opens = 0;
  const value = projection(() => {
    opens++;
    if (opens > 1) return { close() {} };
    return createServerRevocationHandle(binding, {
      timeoutMs: 100,
      revoke() {
        revocations++;
        throw Error("fixture revocation response lost");
      },
      async readRevocation(_target, { signal }) {
        reads++;
        if (reads === 1) return { ...closed, admissionId: "wrong-admission" };
        if (reads === 2) return { ...closed, status: "accepted" };
        if (reads === 3) return { ...closed, proof: "untrusted" };
        if (reads === 4) {
          signal.addEventListener("abort", expired.resolve, { once: true });
          await late.promise;
        }
        return closed;
      },
      verifyReceipt: (target, receipt) => signature(target) === receipt.proof,
    });
  });
  select(value, "task-a");
  assert.equal(await value.view(), true);
  select(value, "task-b");
  await setImmediate();
  for (let attempt = 1; attempt <= 4; attempt++) {
    assert.equal(await value.reconcileViewCleanup(), false);
    assert.equal(reads, attempt);
    assert.equal(value.state().viewCleanup, "unknown");
    assert.equal(await value.view(), false);
  }
  await expired.promise;
  late.resolve();
  await setImmediate();
  assert.equal(value.state().viewCleanup, "unknown");
  assert.equal(await value.reconcileViewCleanup(), true);
  assert.equal(value.state().viewCleanup, "no_unconfirmed_close");
  assert.equal(await value.view(), true);
  assert.equal(opens, 2);
  assert.equal(revocations, 1);
  value.dispose();
});


test(
  "a hung receipt verifier disconnects at the revocation deadline",
  { timeout: 6000 },
  async () => {
    /** @type {string[]} */
    const requests = [];
    let disconnected = false;
    let opens = 0;
    const server = createServer((request, response) => {
      requests.push(`${request.method} ${request.url}`);
      // Keep the proof response pending until the client disconnects.
      response.on("close", () => {
        disconnected = true;
      });
    });
    await new Promise((done) =>
      server.listen(0, "127.0.0.1", () => done(undefined)),
    );
    const address = /** @type {import('node:net').AddressInfo} */ (
      server.address()
    );
    const endpoint = `http://127.0.0.1:${address.port}/verify`;
    const value = projection(() => {
      opens++;
      return createServerRevocationHandle(binding, {
        timeoutMs: 500,
        revoke: () => ({
          ...binding,
          status: "revoked",
          proof: signature(binding),
        }),
        async verifyReceipt(_target, _receipt, options) {
          const response = await fetch(endpoint, { signal: options?.signal });
          return response.ok;
        },
      });
    });
    try {
      select(value, "task-a");
      assert.equal(await value.view(), true);
      select(value, "task-b");
      await until(() => requests.length === 1);
      assert.deepEqual(requests, ["GET /verify"]);
      await until(() => disconnected);
      assert.equal(value.state().viewCleanup, "unknown");
      assert.equal(await value.view(), false);
      assert.equal(opens, 1);
    } finally {
      value.dispose();
      server.closeAllConnections();
      await new Promise((done) => server.close(() => done(undefined)));
    }
  },
);

test("a timed-out passive open keeps ownership until its late handle is revoked", async () => {
  const opened = gate();
  const confirm = gate();
  let calls = 0,
    revocations = 0,
    verified = 0,
    aborted = false;
  const value = projection(async (_request, { signal }) => {
    calls++;
    signal.addEventListener(
      "abort",
      () => {
        aborted = true;
      },
      { once: true },
    );
    await opened.promise;
    return createServerRevocationHandle(binding, {
      async revoke(target) {
        assert.deepEqual(target, binding);
        revocations++;
        await confirm.promise;
        return { ...binding, status: "revoked", proof: signature(binding) };
      },
      verifyReceipt(target, receipt) {
        verified++;
        return receipt.proof === signature(target);
      },
    });
  }, 25);
  let watchdog;
  try {
    select(value, "task-a");
    const result = await Promise.race([
      value.view(),
      new Promise((resolve) => {
        watchdog = setTimeout(() => resolve("still waiting"), 1000);
      }),
    ]);
    assert.equal(result, false, "passive open must settle at its deadline");
    assert.equal(aborted, true);
    assert.equal(value.state().viewCleanup, "unknown");
    select(value, "task-b");
    assert.equal(await value.view(), false);
    assert.equal(calls, 1);

    opened.resolve();
    await until(() => revocations === 1);
    assert.equal(value.state().viewCleanup, "unknown");
    assert.equal(await value.view(), false);
    confirm.resolve();
    await until(() => value.state().viewCleanup === "no_unconfirmed_close");
    assert.equal(calls, 1, "cleanup must not trigger another open");
    assert.equal(revocations, 1);
    assert.equal(verified, 1);
    assert.equal(value.state().canExecute, false);
  } finally {
    clearTimeout(watchdog);
    opened.resolve();
    confirm.resolve();
    value.dispose();
  }
});

test("elapsed passive admission deadlines reject handles before the timer callback", async () => {
  let calls = 0,
    closed = 0;
  const value = projection(() => {
    calls++;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
    return {
      close() {
        closed++;
      },
    };
  }, 10);
  try {
    select(value, "task-a");
    assert.equal(
      await value.view(),
      false,
      "an elapsed deadline must reject a late handle",
    );
    assert.equal(calls, 1);
    assert.equal(closed, 1);
    assert.equal(value.state().viewCleanup, "no_unconfirmed_close");
  } finally {
    value.dispose();
  }
});
