import test from "node:test";
import assert from "node:assert/strict";
import { createFakeConsoleServer } from "../fixtures/console-ui/fake-server.js";
import { createStreamProjection } from "../src/stream.js";
import {
  consoleScenarios,
  syntheticViewerFixtures,
} from "../fixtures/console-ui/scenarios.js";

test("fake read APIs are synthetic, complete, and independently fail closed", async () => {
  let now = 1000;
  const server = createFakeConsoleServer({ clock: () => now, seed: 19 });
  assert.deepEqual(server.facets, [
    "tasks",
    "pinnedHosts",
    "nativeSessions",
    "browsers",
    "leases",
    "traces",
    "artifacts",
    "deliveryReceipts",
  ]);
  for (const name of server.facets) {
    server.put(name, {
      id: `synthetic-${name}`,
      secretCanary: "canary-invented-only",
    });
    const result = await server.read(name);
    assert.equal(result.evidenceClass, "synthetic_component");
    assert.equal(result.observedAt, now);
    assert.equal(result.items[0].id, `synthetic-${name}`);
  }
  server.fail("traces");
  await assert.rejects(server.read("traces"));
  assert.equal((await server.read("artifacts")).status, "ready");
  now = 2000;
  assert.equal((await server.read("tasks")).observedAt, now);
  server.dispose();
  assert.throws(() => server.read("tasks"));
});

test("synthetic stream reorders, deduplicates, detects gaps and never controls", async () => {
  let now = 1000;
  const server = createFakeConsoleServer({ clock: () => now });
  const stream = createStreamProjection({
    clock: () => now,
    readSnapshot: server.readSnapshot,
    subscribe: server.subscribe,
    openPassive: server.openPassive,
    allowedViewOrigins: ["https://viewer.invalid"],
  });
  assert.equal(await stream.connect(consoleScenarios.identity), true);
  assert.equal(stream.state().record.revision, 1);
  const two = server.emit({ label: "revision two" });
  server.replay(two);
  server.replay({ ...two, revision: 1, label: "older" });
  assert.equal(stream.state().record.label, "revision two");
  server.replay({ ...two, revision: 4, label: "gap" });
  assert.equal(stream.state().status, "unknown");
  assert.equal(stream.state().record.gap, true);
  assert.equal(await stream.view(), false);
  assert.equal(server.calls.length, 0);
  stream.dispose();
  server.dispose();
});

test("simulated viewer admission is passive and missing timestamps are unknown", async () => {
  let now = 1000;
  const server = createFakeConsoleServer({ clock: () => now });
  const stream = createStreamProjection({
    clock: () => now,
    readSnapshot: server.readSnapshot,
    subscribe: server.subscribe,
    openPassive: server.openPassive,
    allowedViewOrigins: ["https://viewer.invalid"],
  });
  assert.equal(await stream.connect(consoleScenarios.identity), true);
  assert.match(stream.state().viewLabel, /Simulated/);
  assert.equal(await stream.view(), true);
  assert.equal(server.calls.length, 0);
  for (const [name, fixture] of Object.entries(syntheticViewerFixtures)) {
    if (name === "simulated") continue;
    server.emit(fixture);
    assert.equal(await stream.view(), false, name);
    assert.equal(server.calls.length, 0);
  }
  server.emit({ ...syntheticViewerFixtures.simulated, observedAt: null });
  assert.equal(stream.state().status, "unknown");
  now = 100000;
  assert.equal(stream.state().freshness, "unknown");
  stream.dispose();
  server.dispose();
});
