// Shared assertions executed in both the explicit DOM double and real Chromium.
/** @param {Document} document @param {Function} makeView @param {Function} makeProjection @param {any} scenarios */
export async function assertProjectionDom(
  document,
  makeView,
  makeProjection,
  scenarios,
) {
  let assertions = 0;
  /** @param {unknown} condition @param {string} message */
  function check(condition, message) {
    assertions++;
    if (!condition) throw new Error(message);
  }
  const root = document.createElement("main");
  document.body.append(root);
  const sentinel = document.createElement("button");
  sentinel.textContent = "Outside control";
  root.append(sentinel);
  let now = 1000,
    controlCalls = 0,
    viewCalls = 0;
  const projection = makeProjection({
    clock: () => now,
    openPassive: () => {
      viewCalls++;
      throw new Error("not allowed");
    },
  });
  let current = projection.state();
  const view = makeView(root, { readState: () => current });
  const panel = /** @type {HTMLElement} */ (
    root.querySelector("[data-console-projection]")
  );
  if (!panel) throw new Error("missing projection panel");
  /** @param {string} selector @returns {HTMLElement} */
  function required(selector) {
    const found = panel.querySelector(selector);
    if (!found) throw new Error("missing required node");
    return /** @type {HTMLElement} */ (found);
  }
  /** @param {string} key */
  const field = (key) => required(`[data-field="${key}"]`).textContent ?? "";
  check(
    required('[role="status"]').textContent === "Status: empty",
    "initial empty state",
  );
  check(
    required('[role="status"]').getAttribute("aria-live") === "polite",
    "status announcement semantics",
  );
  check(
    panel.getAttribute("aria-label") === "Read-only task projection",
    "region has accessible name",
  );
  projection.select(scenarios.identity);
  projection.merge(
    {
      ...scenarios.observation,
      identity: scenarios.identity,
      label: scenarios.hostileText,
    },
    { snapshot: true },
  );
  current = projection.state();
  view.update();
  check(
    field("task") === scenarios.identity.task,
    "selected identity rendered",
  );
  check(
    field("label") === scenarios.hostileText,
    "hostile text preserved literally",
  );
  check(
    panel.querySelector("img") === null &&
      panel.querySelector("script") === null,
    "injection creates no elements",
  );
  check(
    panel.querySelector("a") === null && panel.querySelector("iframe") === null,
    "viewer URL inert",
  );
  check(
    panel.querySelector("button") === null &&
      panel.querySelector("input") === null,
    "no control widgets",
  );
  check(
    field("simulation").startsWith("SIMULATED"),
    "simulation label persistent",
  );
  check(field("authority") === "denied", "authority explicit");
  check(
    field("acceptance").startsWith("Unknown") &&
      field("delivery").startsWith("Unknown"),
    "acceptance not confused with delivery",
  );
  panel.focus();
  for (const status of scenarios.statuses) {
    current = { ...current, status };
    view.update();
    check(
      required('[role="status"]').textContent === `Status: ${status}`,
      `status ${status}`,
    );
    check(document.activeElement === panel, "update preserves focused node");
  }
  now = 40_000;
  current = projection.state();
  view.update();
  check(field("freshness") === "stale", "clock refresh shows stale");
  projection.select({ ...scenarios.identity, task: scenarios.longIdentity });
  current = projection.state();
  view.update();
  check(
    field("task") === scenarios.longIdentity && field("label") === "Unknown",
    "navigation clears old task data",
  );
  check(field("observedAt") === "Unknown", "missing timestamp unknown");
  // A throwing adapter/getter cannot partially mix identities or leak errors.
  current = {
    status: "ready",
    identity: {
      task: "new-task",
      get host() {
        throw new Error("secret-canary");
      },
    },
  };
  view.update();
  check(
    field("task") === "Unknown" &&
      !(panel.textContent ?? "").includes("secret-canary"),
    "reader failure clears all old observations",
  );
  current = {
    status: "invented",
    canExecute: true,
    control: () => controlCalls++,
  };
  view.update();
  check(
    required('[role="status"]').textContent === "Status: unknown",
    "unknown status fail closed",
  );
  check(
    controlCalls === 0 && viewCalls === 0,
    "rendering causes zero capability effects",
  );
  // DOM doubles cannot establish reflow. These assertions run only in a real
  // layout engine and do not stand in for screenshot or browser-zoom review.
  if (typeof panel.getBoundingClientRect === "function") {
    current = {
      status: "unknown",
      identity: { task: "t".repeat(256) },
      record: { label: "x".repeat(4096) },
    };
    view.update();
    for (const width of [320, 390, 768, 1440]) {
      root.style.width = `${width}px`;
      for (const size of [16, 32]) {
        root.style.fontSize = `${size}px`;
        check(
          panel.scrollWidth <= panel.clientWidth + 1,
          "long text reflows without horizontal overflow",
        );
        check(
          field("task") === "t".repeat(256) &&
            field("label") === "x".repeat(4096),
          "reflow never truncates identity or observation",
        );
        check(document.activeElement === panel, "reflow preserves focus");
      }
    }
  }
  view.dispose();
  view.dispose();
  check(
    view.update() === false &&
      root.querySelector("[data-console-projection]") === null,
    "dispose removes only owned surface",
  );
  check(root.querySelector("button") === sentinel, "unrelated DOM preserved");
  projection.dispose();
  root.remove();
  return assertions;
}
