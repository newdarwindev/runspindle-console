// Canonical original synthetic scenarios for the read-only Console surface.
// No production records, desktop frames, historical source, or provider calls.
export const consoleScenarios = Object.freeze({
  identity: Object.freeze({
    task: "task-synthetic-1",
    host: "host-synthetic",
    workspace: "workspace-synthetic",
    browser: "browser-synthetic",
    leaseEpoch: 1,
    trace: "trace-synthetic",
  }),
  observation: Object.freeze({
    version: 1,
    revision: 1,
    observedAt: 1000,
    connection: "online",
    authority: "denied",
    evidenceClass: "synthetic_component",
    simulated: true,
    label: "Synthetic task observation",
    viewUrl: "https://viewer.invalid/passive",
  }),
  hostileText:
    '<img src="https://unexpected.invalid/secret-canary" onerror="globalThis.injected=true"><script>globalThis.injected=true</script>',
  longIdentity: "synthetic-".repeat(25),
  statuses: Object.freeze([
    "empty",
    "loading",
    "error",
    "stale",
    "offline",
    "unknown",
    "unsupported",
    "ready",
  ]),
});

export const consoleTaskCatalog = Object.freeze(
  ["a", "b"].map((key) =>
    Object.freeze({
      key,
      label: `Synthetic task ${key}`,
      identity: Object.freeze({
        ...consoleScenarios.identity,
        task: `task-${key}`,
      }),
    }),
  ),
);

export const syntheticViewerFixtures = Object.freeze({
  simulated: Object.freeze({
    connection: "online",
    viewUrl: "https://viewer.invalid/passive",
    simulated: true,
  }),
  unavailable: Object.freeze({
    connection: "unsupported",
    viewUrl: null,
    simulated: true,
  }),
  unauthorized: Object.freeze({
    connection: "online",
    authority: "denied",
    viewUrl: null,
    simulated: true,
  }),
  disconnected: Object.freeze({
    connection: "offline",
    viewUrl: null,
    simulated: true,
  }),
});
