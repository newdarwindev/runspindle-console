import assert from "node:assert/strict";
import test from "node:test";
import { consoleScenarios } from "../fixtures/console-ui/scenarios.js";
import { createProjection } from "../src/projection.js";
import { createStreamProjection } from "../src/stream.js";

const identity = {
  ...consoleScenarios.identity,
  artifactDigest: "sha256:" + "a".repeat(64),
};
const accepted = {
  ...consoleScenarios.observation,
  identity,
  artifactId: "fixture-artifact",
  artifactRevision: 2,
  artifactAcceptance: "accepted",
};
const delivered = {
  ...accepted,
  artifactDelivery: "delivered",
  deliveryOperation: "fixture-delivery",
};

test("artifact evidence requires the exact selected digest and delivery operation", () => {
  const projection = createProjection({ clock: () => 1000 });
  projection.select(consoleScenarios.identity);
  assert.equal(
    projection.merge({ ...accepted, identity: consoleScenarios.identity }),
    false,
  );
  projection.select(identity);
  for (const change of [
    { identity: { ...identity, artifactDigest: "sha256:" + "b".repeat(64) } },
    { artifactRevision: 0 },
    { artifactId: "https://unexpected.invalid" },
    { artifactAcceptance: "validated" },
    { artifactAcceptance: "unknown" },
    { artifactDelivery: "failed" },
    { deliveryOperation: undefined },
  ]) {
    assert.equal(projection.merge({ ...delivered, ...change }), false);
    assert.equal(projection.state().record, null);
  }
  assert.equal(projection.merge(delivered), true);
  assert.equal(projection.state().record?.artifactDelivery, "delivered");
  assert.equal(
    projection.merge({
      ...accepted,
      revision: 2,
      artifactRevision: 3,
      artifactAcceptance: undefined,
    }),
    true,
  );
  const current = projection.state().record;
  assert.equal(current?.artifactRevision, 3);
  assert.equal(current?.artifactAcceptance, "unknown");
  assert.equal(current?.artifactDelivery, "unknown");
  assert.equal(current?.deliveryOperation, undefined);
  projection.dispose();
});

test("artifact stages survive buffering, and a same-revision delivery conflict stops the stream", async () => {
  let snapshots = 0;
  let closes = 0;
  let passiveOpens = 0;
  const stream = createStreamProjection({
    clock: () => 1000,
    readSnapshot: () => {
      snapshots++;
      return snapshots === 1 ? accepted : { ...accepted, revision: 2 };
    },
    subscribe: (_identity, { onEvent }) => {
      if (snapshots === 0) onEvent({ ...delivered, revision: 2 });
      return { close: () => void closes++ };
    },
    openPassive: () => {
      passiveOpens++;
      throw new Error("read-only");
    },
  });
  assert.equal(await stream.connect(identity), true);
  assert.equal(stream.state().record.artifactAcceptance, "accepted");
  assert.equal(stream.state().record.artifactDelivery, "delivered");
  assert.equal(stream.state().record.deliveryOperation, "fixture-delivery");
  stream.disconnect();
  assert.equal(await stream.connect(identity), false);
  assert.equal(stream.state().status, "unknown");
  assert.equal(closes, 2);
  assert.equal(passiveOpens, 0);
  stream.dispose();
});
