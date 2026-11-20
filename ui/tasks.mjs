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

const catalog = [...consoleTaskCatalog];
const snapshots = new Map(
  catalog.map(({ key, identity }) => [
    identity.task,
    {
      ...consoleScenarios.observation,
      identity,
      label:
        key === "b"
          ? consoleScenarios.longIdentity + " " + consoleScenarios.hostileText
          : consoleScenarios.observation.label,
      viewUrl: null,
    },
  ]),
);
const stream = createStreamProjection({
  clock: () => consoleScenarios.observation.observedAt,
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
