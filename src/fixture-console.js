// Functional local fixture UI. No production endpoint or execution capability.
import { createStreamProjection } from "./stream.js";
import { createProjectionView } from "./view.js";

/** @typedef {ReturnType<typeof import('../fixtures/console-ui/fake-server.js').createFakeConsoleServer>} FixtureServer */
/** @typedef {ReturnType<FixtureServer['authority']>} FixtureAuthority */
let fixtureMountSequence = 0;
/** @param {unknown} value @param {Readonly<Record<string,unknown>>} expected */
function fixtureSameIdentity(value, expected) {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === Object.keys(expected).length &&
    Object.entries(expected).every(
      ([key, item]) =>
        Object.hasOwn(value, key) &&
        /** @type {Record<string,unknown>} */ (value)[key] === item,
    )
  );
}
/** @param {unknown} input @param {Readonly<Record<string,unknown>>} expected */
function validFixtureFacet(input, expected) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const value = /** @type {Record<string,unknown>} */ (input);
  const keys = [
    "identity",
    "status",
    "observedAt",
    "revision",
    "evidenceClass",
    "items",
  ];
  if (
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(value, key)) ||
    !fixtureSameIdentity(value.identity, expected) ||
    typeof value.status !== "string" ||
    ![
      "empty",
      "loading",
      "error",
      "unsupported",
      "unknown",
      "offline",
      "stale",
      "ready",
    ].includes(value.status) ||
    !Number.isSafeInteger(value.revision) ||
    /** @type {number} */ (value.revision) < 1 ||
    value.evidenceClass !== "synthetic_component" ||
    !(
      value.observedAt === null ||
      (Number.isSafeInteger(value.observedAt) &&
        /** @type {number} */ (value.observedAt) >= 0)
    ) ||
    !Array.isArray(value.items) ||
    value.items.length > 1024
  )
    return false;
  return value.items.every(
    (item) =>
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      Object.keys(item).length === 5 &&
      ["id", "label", "identity", "delivery", "artifactDigest"].every((key) =>
        Object.hasOwn(item, key),
      ) &&
      typeof item.id === "string" &&
      item.id.length > 0 &&
      item.id.length <= 256 &&
      typeof item.label === "string" &&
      item.label.length <= 4096 &&
      fixtureSameIdentity(item.identity, expected) &&
      ["unknown", "synthetic_confirmed"].includes(item.delivery) &&
      (item.artifactDigest === null ||
        (typeof item.artifactDigest === "string" &&
          /^sha256:[a-f0-9]{64}$/.test(item.artifactDigest))),
  );
}
/** @param {HTMLElement} root @param {{clock:()=>number,maxAgeMs?:number}} options */
export function createFixtureConsole(root, { clock, maxAgeMs = 30 }) {
  if (
    !root?.ownerDocument ||
    typeof clock !== "function" ||
    !Number.isSafeInteger(maxAgeMs) ||
    maxAgeMs < 1
  )
    throw TypeError("fixture DOM and clock required");
  const document = root.ownerDocument;
  const panel = document.createElement("section");
  panel.setAttribute("aria-label", "Synthetic Console fixture");
  const title = document.createElement("h2");
  title.textContent = "SIMULATED Console · synthetic component only";
  const notice = document.createElement("p");
  notice.textContent =
    "No live desktop, provider or execution authority. All control requests go only to an injected synthetic server.";
  const projectionRoot = document.createElement("div");
  projectionRoot.setAttribute("data-fixture-projection", "");
  const facetsRoot = document.createElement("div");
  facetsRoot.setAttribute("data-fixture-facets", "");
  const authorityLabel = document.createElement("p");
  authorityLabel.setAttribute("role", "status");
  authorityLabel.setAttribute("aria-live", "polite");
  authorityLabel.setAttribute("data-fixture-authority", "");
  const reason = document.createElement("p");
  reason.id = `fixture-authority-reason-${++fixtureMountSequence}`;
  reason.textContent = "Unknown authority cannot enable control.";
  const frame = document.createElement("pre");
  frame.setAttribute("role", "img");
  frame.setAttribute("aria-label", "SIMULATED placeholder; not a real desktop");
  frame.setAttribute("data-fixture-frame", "");
  frame.textContent = "SIMULATED · viewer closed";
  /** @param {string} action @param {string} label */
  function button(action, label) {
    const value = document.createElement("button");
    value.type = "button";
    value.textContent = label;
    value.setAttribute("data-fixture-action", action);
    value.setAttribute("aria-describedby", reason.id);
    return value;
  }
  const takeover = button("takeover", "Request simulated takeover"),
    release = button("release", "Request simulated handback"),
    open = button("open", "Open passive simulated view"),
    close = button("close", "Close simulated view"),
    refreshButton = button("refresh", "Refresh synthetic observations");
  panel.append(
    title,
    notice,
    projectionRoot,
    facetsRoot,
    authorityLabel,
    reason,
    takeover,
    release,
    open,
    close,
    refreshButton,
    frame,
  );
  root.append(panel);
  /** @type {FixtureServer|null} */ let server = null;
  /** @type {ReturnType<typeof createStreamProjection>|null} */ let stream =
    null;
  /** @type {ReturnType<typeof createProjectionView>|null} */ let projection =
    null;
  /** @type {AbortController|null} */ let controller = null;
  /** @type {FixtureAuthority|null} */ let authority = null;
  let generation = 0,
    readGeneration = 0,
    authorityHighWater = 0,
    busy = false,
    disposed = false,
    opened = false;
  /** @type {Map<string,{section:HTMLElement,status:HTMLElement,observed:HTMLElement,evidence:HTMLElement,revision:HTMLElement,items:HTMLElement,lastRevision:number,lastObserved:number|null,lastStatus:string}>} */ const facets =
    new Map();
  /** @type {Map<string,FixtureServer>} */ const registry = new Map();
  /** @param {unknown} target */
  function targetServer(target) {
    const result = registry.get(JSON.stringify(target));
    if (!result) throw TypeError("unbound synthetic server");
    return result;
  }
  stream = createStreamProjection({
    clock,
    maxAgeMs,
    allowedViewOrigins: ["https://viewer.invalid"],
    readSnapshot: (target, options) =>
      targetServer(target).readSnapshot(target, options),
    subscribe: (target, callbacks) =>
      targetServer(target).subscribe(target, {
        ...callbacks,
        onEvent: (event) => {
          callbacks.onEvent(event);
          projection?.update();
        },
        onDisconnect: () => {
          callbacks.onDisconnect();
          projection?.update();
        },
      }),
    openPassive: (request, options) => {
      if (!request || typeof request !== "object")
        throw TypeError("invalid passive request");
      const value =
        /** @type {{identity:Readonly<Record<string,unknown>>,mode:string,url?:unknown,simulated?:unknown}} */ (
          request
        );
      return targetServer(value.identity).openPassive(value, options);
    },
  });
  function cleanupUnknown() {
    return (
      stream?.state().viewCleanup === "unknown" ||
      stream?.state().subscriptionCleanup === "unknown"
    );
  }
  function buttons() {
    takeover.disabled = busy || !authority?.canTakeover || cleanupUnknown();
    release.disabled = busy || !authority?.canRelease || cleanupUnknown();
    open.disabled =
      busy ||
      opened ||
      !stream ||
      stream.state().status !== "ready" ||
      cleanupUnknown();
    close.disabled = busy || !opened;
    refreshButton.disabled = disposed || !server;
  }
  function refreshAuthority() {
    if (!server) return;
    const current = clock();
    if (
      authority &&
      (authority.observedAt === null ||
        !Number.isSafeInteger(current - authority.observedAt) ||
        current - authority.observedAt < 0 ||
        current - authority.observedAt > maxAgeMs)
    )
      authority = null;
    try {
      const next = server.authority();
      const age = next.observedAt === null ? NaN : current - next.observedAt;
      const valid =
        fixtureSameIdentity(next.identity, server.identity) &&
        next.evidenceClass === "synthetic_component" &&
        Number.isSafeInteger(next.revision) &&
        next.revision >= 1 &&
        Number.isSafeInteger(age) &&
        age >= 0 &&
        age <= maxAgeMs &&
        [
          "pending",
          "denied",
          "human",
          "agent",
          "unknown",
          "handback_pending",
        ].includes(next.state) &&
        next.canExecute === false &&
        typeof next.canTakeover === "boolean" &&
        typeof next.canRelease === "boolean" &&
        (!next.canTakeover || ["denied", "agent"].includes(next.state)) &&
        (!next.canRelease || next.state === "human");
      if (!valid) authority = null;
      else if (next.revision >= authorityHighWater) {
        authority = next;
        authorityHighWater = next.revision;
      }
    } catch {
      authority = null;
    }
    authorityLabel.textContent = authority
      ? `Authority: ${authority.state} · observed ${authority.observedAt} · synthetic_component`
      : "Authority: unknown · no current matching server observation";
    reason.textContent = cleanupUnknown()
      ? "Viewer closure or subscription cleanup unconfirmed; control remains disabled."
      : "Button state follows the exact synthetic server identity/epoch. UI text cannot grant permission; execution is unavailable.";
    buttons();
  }

  /** @param {string} name */
  function addFacet(name) {
    const section = document.createElement("section");
    section.setAttribute("aria-label", name);
    section.setAttribute("data-fixture-facet", name);
    const heading = document.createElement("h3");
    heading.textContent = name;
    const status = document.createElement("p"),
      observed = document.createElement("p"),
      evidence = document.createElement("p"),
      revision = document.createElement("p"),
      items = document.createElement("ul");
    status.setAttribute("role", "status");
    status.setAttribute("data-facet-status", name);
    observed.setAttribute("data-facet-observed", name);
    evidence.setAttribute("data-facet-evidence", name);
    items.setAttribute("data-facet-items", name);
    status.textContent = "loading";
    observed.textContent = "Observed: unknown";
    evidence.textContent = "Evidence: unknown";
    section.append(heading, status, observed, evidence, revision, items);
    facetsRoot.append(section);
    facets.set(name, {
      section,
      status,
      observed,
      evidence,
      revision,
      items,
      lastRevision: 0,
      lastObserved: null,
      lastStatus: "unknown",
    });
  }
  async function refresh() {
    if (disposed || !server || !controller) return false;
    const source = server,
      token = generation,
      read = ++readGeneration,
      signal = controller.signal;
    refreshAuthority();
    for (const nodes of facets.values()) {
      if (nodes.lastStatus === "ready") {
        const age =
          nodes.lastObserved === null ? NaN : clock() - nodes.lastObserved;
        nodes.status.textContent =
          Number.isSafeInteger(age) && age >= 0
            ? age <= maxAgeMs
              ? "ready"
              : "stale"
            : "unknown";
      }
    }
    await Promise.all(
      source.facets.map(async (name) => {
        const nodes = facets.get(name);
        if (!nodes) return;
        try {
          const value = await source.read(name, {
            identity: source.identity,
            signal,
          });
          if (
            disposed ||
            token !== generation ||
            read !== readGeneration ||
            signal.aborted
          )
            return;
          if (!validFixtureFacet(value, source.identity)) {
            nodes.lastStatus = "unknown";
            nodes.status.textContent = "unknown";
            nodes.observed.textContent = "Observed: unknown";
            nodes.evidence.textContent = "Evidence: unknown";
            nodes.items.replaceChildren();
            return;
          }
          if (
            !Number.isSafeInteger(value.revision) ||
            value.revision < nodes.lastRevision
          )
            return;
          nodes.lastRevision = value.revision;
          nodes.lastObserved = value.observedAt;
          nodes.lastStatus = value.status;
          const age =
            value.observedAt === null ? NaN : clock() - value.observedAt;
          const fresh =
            Number.isSafeInteger(age) && age >= 0 && age <= maxAgeMs;
          const status =
            value.evidenceClass !== "synthetic_component"
              ? "unknown"
              : value.status === "ready"
                ? fresh
                  ? "ready"
                  : Number.isSafeInteger(age) && age > maxAgeMs
                    ? "stale"
                    : "unknown"
                : value.status;
          nodes.status.textContent = status;
          nodes.observed.textContent = `Observed: ${value.observedAt === null ? "unknown" : value.observedAt}`;
          nodes.evidence.textContent = `Evidence: ${value.evidenceClass}`;
          nodes.revision.textContent = `Source revision: ${value.revision}`;
          nodes.items.replaceChildren();
          for (const item of value.items) {
            const row = document.createElement("li");
            row.textContent = JSON.stringify(item);
            row.style.overflowWrap = "anywhere";
            nodes.items.append(row);
          }
        } catch {
          if (token === generation && read === readGeneration && !disposed) {
            nodes.lastStatus = "error";
            nodes.status.textContent = "error";
            nodes.observed.textContent = "Observed: unknown";
            nodes.evidence.textContent = "Evidence: unknown";
            nodes.items.replaceChildren();
          }
        }
      }),
    );
    if (token !== generation || disposed) return false;
    projection?.update();
    refreshAuthority();
    return true;
  }
  /** @param {FixtureServer} next */
  async function select(next) {
    if (disposed) return false;
    const token = ++generation;
    controller?.abort();
    stream?.disconnect();
    projection?.dispose();
    projectionRoot.replaceChildren();
    facetsRoot.replaceChildren();
    facets.clear();
    authority = null;
    authorityHighWater = 0;
    busy = false;
    opened = false;
    frame.textContent = "SIMULATED · viewer closed";
    server = next;
    controller = new globalThis.AbortController();
    if (registry.size >= 32 && !registry.has(JSON.stringify(next.identity)))
      throw Error("fixture target capacity");
    registry.set(JSON.stringify(next.identity), next);
    if (!stream) throw Error("missing fixture stream");
    const active = stream;
    projection = createProjectionView(projectionRoot, {
      readState: () => active.state(),
    });
    next.facets.forEach(addFacet);
    refreshAuthority();
    const connection = active.connect(next.identity);
    const reads = refresh();
    const ready = await connection;
    await reads;
    if (token !== generation || disposed) return false;
    projection?.update();
    refreshAuthority();
    return ready;
  }
  /** @param {'takeover'|'release'} action */
  async function control(action) {
    if (disposed || busy || !server) return false;
    refreshAuthority();
    if (
      cleanupUnknown() ||
      !(action === "takeover" ? authority?.canTakeover : authority?.canRelease)
    )
      return false;
    const source = server,
      token = generation;
    busy = true;
    buttons();
    try {
      await source.control(
        {
          identity: source.identity,
          action,
          requestId: source.allocateRequestId(),
        },
        { signal: controller?.signal },
      );
      if (token !== generation || disposed) return false;
      refreshAuthority();
      return true;
    } catch {
      if (token === generation) {
        authority = null;
        authorityLabel.textContent =
          "Authority: unknown · request not confirmed";
      }
      return false;
    } finally {
      if (token === generation) {
        busy = false;
        buttons();
      }
    }
  }
  async function openView() {
    if (disposed || busy || !stream || opened || cleanupUnknown()) return false;
    const active = stream,
      token = generation;
    busy = true;
    buttons();
    try {
      const admitted = await active.view();
      if (token !== generation || disposed) return false;
      opened = admitted;
      frame.textContent = admitted
        ? "SIMULATED — synthetic workspace, no live pixels or interactive input"
        : "SIMULATED · viewer unavailable or unauthorized";
      return admitted;
    } finally {
      if (token === generation) {
        busy = false;
        refreshAuthority();
      }
    }
  }
  async function closeView() {
    if (!stream || disposed) return false;
    stream.disconnect();
    opened = false;
    const unknown = cleanupUnknown();
    frame.textContent = unknown
      ? "SIMULATED · viewer closure unconfirmed"
      : "SIMULATED · viewer closed";
    projection?.update();
    refreshAuthority();
    open.focus();
    return !unknown;
  }
  const onTakeover = () => {
      void control("takeover");
    },
    onRelease = () => {
      void control("release");
    },
    onOpen = () => {
      void openView();
    },
    onClose = () => {
      void closeView();
    },
    onRefresh = () => {
      void refresh();
    };
  takeover.addEventListener("click", onTakeover);
  release.addEventListener("click", onRelease);
  open.addEventListener("click", onOpen);
  close.addEventListener("click", onClose);
  refreshButton.addEventListener("click", onRefresh);
  buttons();
  function dispose() {
    if (disposed) return;
    disposed = true;
    generation++;
    controller?.abort();
    stream?.dispose();
    projection?.dispose();
    takeover.removeEventListener("click", onTakeover);
    release.removeEventListener("click", onRelease);
    open.removeEventListener("click", onOpen);
    close.removeEventListener("click", onClose);
    refreshButton.removeEventListener("click", onRefresh);
    panel.remove();
  }
  return Object.freeze({
    select,
    refresh,
    control,
    openView,
    closeView,
    dispose,
    state: () =>
      Object.freeze({
        identity: server?.identity,
        authority: authority?.state ?? "unknown",
        busy,
        opened,
        canExecute: false,
        generation,
      }),
  });
}
