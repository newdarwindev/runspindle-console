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

const byId = new Map(visualScenarios.map((s) => [s.id, s]));
const selector = document.querySelector("#scenario");
const projectionRoot = document.querySelector("#projection");
const navigationRoot = document.querySelector("#navigation-root");
const dialog = document.querySelector("#preview-dialog");
const previewButton = document.querySelector("#inspect-preview");
let projection = null,
  navigator = null,
  stream = null,
  releaseLate = null;
let generation = 0,
  selected = null;
let effects = {
  subscriptions: 0,
  closes: 0,
  snapshots: 0,
  passive: 0,
  control: 0,
};
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
document
  .querySelector("#preview-close")
  .addEventListener("click", closeReference);
document
  .querySelector("#preview-cancel")
  .addEventListener("click", closeReference);
dialog.addEventListener("cancel", () => {
  queueMicrotask(() => previewButton.focus());
});
dialog.addEventListener("close", () => {
  previewButton.focus();
});

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
  document.querySelector("#scenario-title").textContent = scenario.title;
  document.querySelector("#scenario-note").textContent = scenario.note;
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
  document
    .querySelector("#simulated-frame")
    .setAttribute(
      "aria-label",
      `SIMULATED desktop reference. ${scenario.desktop}. No real screen or input.`,
    );
  const demo =
    scenario.interaction !== "inspect-only" &&
    scenario.interaction !== "preview";
  document.querySelector("#navigation-demo").hidden = !demo;
  document.querySelector("#late-response").hidden =
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
document.querySelector("#late-response").addEventListener("click", async () => {
  const release = releaseLate;
  releaseLate = null;
  release?.();
  await Promise.resolve();
  await Promise.resolve();
  navigator?.update();
});
document
  .querySelector("#history-back")
  .addEventListener("click", () => history.back());
document
  .querySelector("#history-forward")
  .addEventListener("click", () => history.forward());
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
