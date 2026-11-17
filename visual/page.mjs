/* global document: readonly, window: readonly, history: readonly, queueMicrotask: readonly, requestAnimationFrame: readonly */
// Original local reference page. Reuses product DOM/navigation; owns no authority.
import { createProjectionView } from "../src/view.js";
import {
  createTaskNavigator,
  createBrowserTaskHistory,
} from "../src/navigation.js";
import { createStreamProjection } from "../src/stream.js";
import {
  consoleScenarios,
  consoleTaskCatalog,
} from "../fixtures/console-ui/scenarios.js";
import {
  visualScenarios,
  visualIdentity,
  referenceState,
} from "./scenarios.mjs";

/** @template {HTMLElement} T
 * @param {string} selector
 * @param {{new(...args: never[]): T}} type
 * @returns {T}
 */
function requiredElement(selector, type) {
  const node = document.querySelector(selector);
  if (!(node instanceof type))
    throw new TypeError(`missing or invalid reference element: ${selector}`);
  return node;
}
const byId = new Map(visualScenarios.map((s) => [s.id, s]));
const selector = requiredElement("#scenario", window.HTMLSelectElement);
const projectionRoot = requiredElement("#projection", window.HTMLElement);
const navigationRoot = requiredElement("#navigation-root", window.HTMLElement);
const dialog = requiredElement("#preview-dialog", window.HTMLDialogElement);
const previewButton = requiredElement(
  "#inspect-preview",
  window.HTMLButtonElement,
);
/** @type {ReturnType<typeof createProjectionView> | null} */
let projection = null;
/** @type {ReturnType<typeof createTaskNavigator> | null} */
let navigator = null;
/** @type {ReturnType<typeof createStreamProjection> | null} */
let stream = null;
/** @type {(() => void) | null} */
let releaseLate = null;
let generation = 0;
/** @type {typeof visualScenarios[number] | null} */
let selected = null;
let effects = {
  subscriptions: 0,
  closes: 0,
  snapshots: 0,
  passive: 0,
  control: 0,
};
/** @param {string} key @param {string} value */
function putVisual(key, value) {
  const node = document.querySelector(`[data-visual-field="${key}"]`);
  if (node) node.textContent = String(value);
}
function closeReference() {
  if (dialog.open) dialog.close();
  previewButton.focus();
}
previewButton.addEventListener("click", () => {
  if (!dialog.open) dialog.showModal();
});
requiredElement("#preview-close", window.HTMLElement).addEventListener(
  "click",
  closeReference,
);
requiredElement("#preview-cancel", window.HTMLElement).addEventListener(
  "click",
  closeReference,
);
dialog.addEventListener("cancel", () => {
  queueMicrotask(() => previewButton.focus());
});
dialog.addEventListener("close", () => {
  previewButton.focus();
});

/** @param {string} id */
async function selectScenario(id) {
  const scenario = byId.get(id);
  if (!scenario) throw new TypeError("unknown synthetic visual scenario");
  const ticket = ++generation;
  document.body.dataset.ready = "false";
  if (dialog.open) dialog.close();
  navigator?.dispose();
  navigator = null;
  stream = null;
  releaseLate = null;
  projection?.dispose();
  projection = null;
  projectionRoot.replaceChildren();
  navigationRoot.replaceChildren();
  effects = {
    subscriptions: 0,
    closes: 0,
    snapshots: 0,
    passive: 0,
    control: 0,
  };
  selected = scenario;
  selector.value = id;
  requiredElement("#scenario-title", window.HTMLElement).textContent =
    scenario.title;
  requiredElement("#scenario-note", window.HTMLElement).textContent =
    scenario.note;
  const state = referenceState(scenario);
  projection = createProjectionView(projectionRoot, { readState: () => state });
  const visible = {
    fleet: "fleet-synthetic-01",
    source: "synthetic-console-fixture",
    sourceTimestamp:
      scenario.observedAt === null
        ? "Unknown — source timestamp missing"
        : "1970-01-01T00:00:01.000Z (fixed synthetic source time)",
    account: "account-synthetic",
    holder: "holder-synthetic-a",
    receipt: scenario.receipt,
    telemetry: scenario.telemetry,
    acceptance: scenario.acceptance,
    delivery: scenario.delivery,
    desktop: scenario.desktop,
    authorityPresentation: scenario.authorityPresentation,
    controlReason: scenario.reason,
  };
  for (const [key, value] of Object.entries(visible)) putVisual(key, value);
  requiredElement("#simulated-frame", window.HTMLElement).setAttribute(
    "aria-label",
    `SIMULATED desktop reference. ${scenario.desktop}. No real screen or input.`,
  );
  const demo =
    scenario.interaction !== "inspect-only" &&
    scenario.interaction !== "preview";
  requiredElement("#navigation-demo", window.HTMLElement).hidden = !demo;
  requiredElement("#late-response", window.HTMLElement).hidden =
    scenario.interaction !== "late-switch";
  if (demo) {
    let held = false;
    stream = createStreamProjection({
      clock: () => 1000,
      subscribe: () => {
        effects.subscriptions++;
        return {
          close: () => {
            effects.closes++;
          },
        };
      },
      readSnapshot: (identity) => {
        effects.snapshots++;
        const answer = { ...consoleScenarios.observation, identity };
        if (
          scenario.interaction === "late-switch" &&
          identity.task === "task-a" &&
          !held
        ) {
          held = true;
          return new Promise((resolve) => {
            releaseLate = () => resolve(answer);
          });
        }
        return answer;
      },
      openPassive: () => {
        effects.passive++;
        throw Error("forbidden real passive view");
      },
    });
    const catalog = consoleTaskCatalog.map((task) => ({
      ...task,
      identity: { ...visualIdentity, ...task.identity },
    }));
    const old =
      history.state && typeof history.state === "object" ? history.state : {};
    history.replaceState({ ...old, runspindleConsoleTask: "a" }, "");
    navigator = createTaskNavigator(navigationRoot, {
      catalog,
      stream,
      history: createBrowserTaskHistory(window),
    });
    await navigator.navigate("b");
    // All ready-state promises below are actual view/font settlement, not timers.
    navigator.update();
  }
  await document.fonts.ready;
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
  if (ticket !== generation) return false;
  document.body.dataset.scenario = id;
  document.body.dataset.ready = "true";
  return true;
}
requiredElement("#late-response", window.HTMLElement).addEventListener(
  "click",
  async () => {
    const release = releaseLate;
    releaseLate = null;
    release?.();
    await Promise.resolve();
    await Promise.resolve();
    navigator?.update();
  },
);
requiredElement("#history-back", window.HTMLElement).addEventListener(
  "click",
  () => history.back(),
);
requiredElement("#history-forward", window.HTMLElement).addEventListener(
  "click",
  () => history.forward(),
);
selector.addEventListener("change", () => {
  void selectScenario(selector.value);
});
for (const scenario of visualScenarios) {
  const option = document.createElement("option");
  option.value = scenario.id;
  option.textContent = scenario.title;
  selector.append(option);
}
globalThis.consoleVisual = Object.freeze({
  scenarios: Object.freeze(visualScenarios.map((s) => s.id)),
  select: selectScenario,
  state: () => ({
    scenario: selected?.id,
    effects: { ...effects },
    projection:
      stream?.state() ?? referenceState(selected ?? visualScenarios[0]),
    dialogOpen: dialog.open,
  }),
});
void selectScenario("fresh");
