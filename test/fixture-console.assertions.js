// Shared actual-DOM assertions. No Node APIs, screenshots, real provider or control.
import { createFakeConsoleServer } from "../fixtures/console-ui/fake-server.js";
import { consoleScenarios } from "../fixtures/console-ui/scenarios.js";
import { createFixtureConsole } from "../src/fixture-console.js";

/** @param {Document} document */
export async function assertFixtureConsole(document) {
  let checks = 0;
  /** @param {unknown} condition @param {string} message */
  function verify(condition, message) {
    checks++;
    if (!condition) throw Error(message);
  }
  let now = 1000;
  const identity = {
    ...consoleScenarios.identity,
    nativeSession: "native-fixture",
    span: "span-fixture",
    artifactDigest: "sha256:" + "f".repeat(64),
  };
  const server = createFakeConsoleServer({
    clock: () => now,
    identity,
    secrets: ["CANARY_FIXTURE_SECRET"],
  });
  const other = createFakeConsoleServer({
    clock: () => now,
    identity: { ...identity, task: "task-next", nativeSession: "native-next" },
  });
  const root = document.createElement("main");
  document.body.append(root);
  const ui = createFixtureConsole(root, { clock: () => now });
  /** @param {string} selector */
  function element(selector) {
    const node = root.querySelector(selector);
    if (!node) throw Error("missing assertion element " + selector);
    return node;
  }
  try {
    for (const name of server.facets)
      server.put(name, {
        id: `record-${name}`,
        label:
          '<img src="https://unexpected.invalid/CANARY_FIXTURE_SECRET" onerror="globalThis.injected=true">',
      });
    verify(await ui.select(server), "real fixture selection failed");
    verify(
      root.querySelectorAll("[data-fixture-facet]").length === 8,
      "eight facets missing",
    );
    verify(
      root.querySelectorAll("img,script,a,iframe").length === 0,
      "unsafe markup/link executed",
    );
    verify(
      !root.textContent?.includes("CANARY_FIXTURE_SECRET"),
      "configured canary exposed",
    );
    verify(
      root.textContent?.includes("SIMULATED"),
      "simulation warning missing",
    );
    for (const name of server.facets) {
      verify(
        element(`[data-facet-status="${name}"]`).textContent === "ready",
        "facet not ready",
      );
      verify(
        element(`[data-facet-items="${name}"]`).textContent?.includes(
          "native-fixture",
        ),
        "native identity lost",
      );
      verify(
        element(`[data-facet-evidence="${name}"]`).textContent?.includes(
          "synthetic_component",
        ),
        "evidence missing",
      );
    }
    verify(
      root.querySelectorAll('[role="status"]').length >= 9,
      "status semantics missing",
    );
    for (const button of root.querySelectorAll("button")) {
      verify(button.textContent?.trim(), "button accessible name missing");
      const reason = button.getAttribute("aria-describedby");
      verify(
        reason && document.getElementById(reason)?.textContent,
        "button explanation missing",
      );
    }
    verify(
      element("[data-fixture-frame]")
        .getAttribute("aria-label")
        ?.includes("SIMULATED"),
      "simulated frame alternative missing",
    );
    verify(await ui.openView(), "passive view failed");
    verify(server.calls.length === 0, "passive view emitted control");
    verify(server.passiveCalls.length === 1, "passive admission count");
    verify(!ui.state().canExecute, "fixture exposes execution");
    verify(await ui.closeView(), "viewer did not close");
    verify(server.resources.viewers === 0, "viewer resource leaked");
    await ui.select(server);
    verify(await ui.control("takeover"), "takeover request failed");
    verify(
      ui.state().authority === "pending",
      "click wrongly grants authority",
    );
    verify(server.calls.length === 1, "takeover count wrong");
    server.decide("human");
    await ui.refresh();
    verify(
      !(
        /** @type {HTMLButtonElement} */ (
          element('[data-fixture-action="release"]')
        ).disabled
      ),
      "grant not reflected in handback button",
    );
    verify(await ui.control("release"), "handback request failed");
    verify(
      ui.state().authority === "handback_pending",
      "incomplete handback hidden",
    );
    server.decide("unknown");
    await ui.refresh();
    const button = /** @type {HTMLButtonElement} */ (
      element('[data-fixture-action="takeover"]')
    );
    button.disabled = false;
    button.click();
    await Promise.resolve();
    verify(server.calls.length === 2, "forged DOM granted authority");
    server.setFacet("tasks", "unsupported");
    await ui.refresh();
    verify(
      element('[data-facet-status="tasks"]').textContent === "unsupported",
      "unsupported hidden",
    );
    server.setFacet("tasks", "ready", null);
    await ui.refresh();
    verify(
      element('[data-facet-status="tasks"]').textContent === "unknown",
      "missing time fresh",
    );
    now = 2000;
    await ui.refresh();
    verify(
      element('[data-facet-status="traces"]').textContent === "stale",
      "fetch time relabeled source fresh",
    );
    verify(
      element('[data-facet-observed="traces"]').textContent ===
        "Observed: 1000",
      "source time changed",
    );
    const releaseRead = server.deferNext("tasks");
    const old = ui.refresh();
    other.put("tasks", { id: "new-target" });
    await ui.select(other);
    releaseRead();
    await old;
    verify(
      element('[data-facet-items="tasks"]').textContent?.includes("new-target"),
      "late old task replaced new",
    );
    verify(
      ui.state().identity?.nativeSession === "native-next",
      "session switched incorrectly",
    );
    const abort = new globalThis.AbortController();
    other.deferNext("tasks");
    const delayed = other.read("tasks", { signal: abort.signal });
    abort.abort();
    let aborted = false;
    try {
      await delayed;
    } catch {
      aborted = true;
    }
    verify(aborted && other.resources.delays === 0, "abort left pending read");
    const genuine = await other.read("tasks");
    /** @type {typeof other} */
    const foreign = {
      ...other,
      read: async (name, options) =>
        name === "tasks"
          ? {
              ...genuine,
              identity: { ...other.identity, task: "foreign-canary" },
            }
          : other.read(name, options),
    };
    await ui.select(foreign);
    verify(
      element('[data-facet-status="tasks"]').textContent === "unknown",
      "foreign envelope rendered",
    );
    verify(
      !root.textContent?.includes("foreign-canary"),
      "foreign binding leaked",
    );
    other.decide("human");
    let authorityObservation = other.authority();
    const staleSource = { ...other, authority: () => authorityObservation };
    await ui.select(staleSource);
    verify(
      !(
        /** @type {HTMLButtonElement} */ (
          element('[data-fixture-action="release"]')
        ).disabled
      ),
      "fresh grant not shown",
    );
    now += 40;
    authorityObservation = {
      ...authorityObservation,
      state: "denied",
      revision: 1,
      observedAt: now,
      canTakeover: true,
      canRelease: false,
    };
    await ui.refresh();
    verify(
      /** @type {HTMLButtonElement} */ (
        element('[data-fixture-action="release"]')
      ).disabled,
      "expired cached grant survived old reply",
    );
    verify(ui.state().authority === "unknown", "expired authority not unknown");
    const extraRoot = document.createElement("aside");
    document.body.append(extraRoot);
    const extra = createFixtureConsole(extraRoot, { clock: () => now });
    try {
      const first = element('[data-fixture-action="takeover"]').getAttribute(
          "aria-describedby",
        ),
        second = extraRoot
          .querySelector('[data-fixture-action="takeover"]')
          ?.getAttribute("aria-describedby");
      verify(
        first && second && first !== second,
        "simultaneous reason IDs collide",
      );
    } finally {
      extra.dispose();
      extraRoot.remove();
    }
    return {
      checks,
      evidenceClass: "synthetic_component_actual_dom",
      canExecute: ui.state().canExecute,
      controlRequests: server.calls.length,
      passiveAdmissions: server.passiveCalls.length,
    };
  } finally {
    ui.dispose();
    server.dispose();
    other.dispose();
    root.remove();
  }
}
