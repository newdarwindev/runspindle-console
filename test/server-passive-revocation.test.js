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

/** @param {import('../src/projection.js').ProjectionOptions['openPassive']} openPassive */
function projection(openPassive) {
  return createProjection({
    clock: () => 1000,
    openPassive,
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
  assert.equal(await value.view(), false);
  value.dispose();
});
