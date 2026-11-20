/* global document, window */
import {
  consoleScenarios,
  consoleTaskCatalog,
} from "../fixtures/console-ui/scenarios.js";
import {
  createBrowserTaskHistory,
  createTaskNavigator,
} from "../src/navigation.js";
import { createStreamProjection } from "../src/stream.js";

const catalog = consoleTaskCatalog.map(({ key, label, identity }) => ({
  key,
  label,
  identity: {
    ...identity,
    host: `host-synthetic-${key}`,
    workspace: `workspace-synthetic-${key}`,
    nativeSession: `session-synthetic-${key}`,
    browser: `browser-synthetic-${key}`,
    leaseEpoch: key === "a" ? 1 : 2,
    trace: `trace-synthetic-${key}`,
    span: `span-synthetic-${key}`,
    artifactDigest: "sha256:" + key.repeat(64),
  },
}));
const maxAgeMs = 1000;
const now = consoleScenarios.observation.observedAt + maxAgeMs + 1;
const snapshots = new Map(
  catalog.map(({ key, identity }) => [
    identity.task,
    {
      ...consoleScenarios.observation,
      identity,
      observedAt: key === "a" ? now : consoleScenarios.observation.observedAt,
      label:
        key === "b"
          ? consoleScenarios.longIdentity + " " + consoleScenarios.hostileText
          : consoleScenarios.observation.label,
      viewUrl: null,
    },
  ]),
);
const stream = createStreamProjection({
  clock: () => now,
  maxAgeMs,
  subscribe: () => ({ close() {} }),
  readSnapshot: ({ task }) => snapshots.get(task),
});
const root = document.getElementById("tasks");
if (!root) throw Error("task workspace root missing");
createTaskNavigator(root, {
  catalog,
  stream,
  history: createBrowserTaskHistory(window, catalog[0].key),
});
