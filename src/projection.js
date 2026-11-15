/* global AbortController */
// Provisional, process-local console API. This is not a shared wire protocol.
/** @typedef {Record<string, unknown>} ProjectionIdentity */
/** @typedef {{revision:number, observedAt:number|null, connection:string, authority:string, evidenceClass:string, label:string, simulated:boolean, gap:boolean, viewUrl:string|null}} ProjectionRecord */
/** @typedef {{clock?:()=>number, readSnapshot?:(target:ProjectionIdentity, options:{signal:AbortSignal})=>any, openPassive?:(request:unknown, options:{signal:AbortSignal})=>any, allowedViewOrigins?:string[], maxAgeMs?:number}} ProjectionOptions */
const ID_KEYS = [
  "task",
  "host",
  "workspace",
  "nativeSession",
  "browser",
  "leaseEpoch",
  "trace",
  "span",
  "artifactDigest",
];
const STATES = new Set(["online", "offline", "unknown", "unsupported"]);
const AUTHORITY = new Set([
  "unknown",
  "pending",
  "denied",
  "agent",
  "human",
  "handback_pending",
]);
const EVIDENCE = new Set([
  "synthetic_component",
  "isolated_integration",
  "live_acceptance",
  "retained_local",
]);

/** @param {any} value @returns {Readonly<ProjectionIdentity>} */
function identity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("invalid identity");
  const original = value;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(original)))
    throw new TypeError("invalid identity prototype");
  value = Object.create(null);
  for (const key of Reflect.ownKeys(original)) {
    const descriptor = /** @type {PropertyDescriptor} */ (
      Object.getOwnPropertyDescriptor(original, key)
    );
    if (
      !ID_KEYS.includes(/** @type {string} */ (key)) ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, "value")
    )
      throw new TypeError("invalid identity field");
    value[key] = descriptor.value;
  }
  for (const key of ["task", "host", "workspace"]) {
    if (
      typeof value[key] !== "string" ||
      !value[key].length ||
      value[key].length > 256
    )
      throw new TypeError("invalid identity");
  }
  for (const key of ["nativeSession", "browser", "trace", "span"]) {
    if (
      value[key] !== undefined &&
      (typeof value[key] !== "string" ||
        !value[key].length ||
        value[key].length > 256)
    )
      throw new TypeError("invalid identity");
  }
  if (
    value.artifactDigest !== undefined &&
    (typeof value.artifactDigest !== "string" ||
      !/^sha256:[a-f0-9]{64}$/.test(value.artifactDigest))
  )
    throw new TypeError("invalid artifact digest");
  if (value.span !== undefined && !value.trace)
    throw new TypeError("span without trace");
  if (
    value.leaseEpoch !== undefined &&
    (!Number.isSafeInteger(value.leaseEpoch) ||
      value.leaseEpoch < 0 ||
      !value.browser)
  )
    throw new TypeError("invalid lease");
  return Object.freeze({ ...value });
}

/** @param {ProjectionIdentity} left @param {ProjectionIdentity} right */
function sameIdentity(left, right) {
  return ID_KEYS.every((key) => left[key] === right[key]);
}

/** @param {unknown} value @param {string[]} allowedOrigins */
export function safeViewUrl(value, allowedOrigins) {
  try {
    if (typeof value !== "string" || value.length > 2048) return null;
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      allowedOrigins.includes(url.origin)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

// For a future text renderer; never insert raw adapter strings as HTML.
/** @param {unknown} value */
export function escapeText(value) {
  if (typeof value !== "string" || value.length > 4096)
    throw new TypeError("invalid text");
  return value.replace(
    /[&<>"']/g,
    (character) =>
      /** @type {Record<string,string>} */ ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

/** @param {ProjectionOptions} options */
export function createProjection({
  clock,
  readSnapshot,
  openPassive,
  allowedViewOrigins = [],
  maxAgeMs = 30_000,
} = {}) {
  if (
    typeof clock !== "function" ||
    !Number.isSafeInteger(maxAgeMs) ||
    maxAgeMs <= 0
  )
    throw new TypeError("invalid clock or age");
  if (
    !Array.isArray(allowedViewOrigins) ||
    allowedViewOrigins.some(
      (origin) => safeViewUrl(origin, [origin]) !== `${origin}/`,
    )
  )
    throw new TypeError("invalid allowed origins");
  let target = /** @type {Readonly<ProjectionIdentity>|null} */ (null),
    generation = 0,
    latestRequest = 0,
    phase = "empty",
    record = /** @type {Readonly<ProjectionRecord>|null} */ (null);
  let pendingRead = /** @type {AbortController|null} */ (null),
    pendingView = /** @type {AbortController|null} */ (null),
    activeView = /** @type {{close:()=>void}|null} */ (null),
    disposed = false,
    releasingView = false;

  /** @param {{close:()=>void}} handle */
  function closeView(handle) {
    const previousRelease = releasingView;
    releasingView = true;
    try {
      handle.close();
    } finally {
      releasingView = previousRelease;
    }
  }
  function releaseView() {
    // Detach owned resources before adapter callbacks can create newer work.
    const pending = pendingView,
      active = activeView;
    pendingView = null;
    activeView = null;
    const previousRelease = releasingView;
    releasingView = true;
    try {
      pending?.abort();
      if (active) {
        try {
          closeView(active);
        } catch {
          /* No authority is granted when adapter cleanup fails. */
        }
      }
    } finally {
      releasingView = previousRelease;
    }
  }
  /** @param {unknown} next */
  function select(next) {
    if (disposed) throw new Error("projection disposed");
    const parsed = identity(next);
    generation++;
    const previousRead = pendingRead;
    pendingRead = null;
    target = parsed;
    record = null;
    phase = "empty";
    releaseView();
    previousRead?.abort();
  }
  /** @param {any} update @param {{snapshot?:boolean}} options */
  function merge(update, { snapshot = false } = {}) {
    if (disposed || !target) return false;
    let incoming;
    try {
      incoming = identity(update.identity);
    } catch {
      return false;
    }
    if (
      !sameIdentity(target, incoming) ||
      update.version !== 1 ||
      !Number.isSafeInteger(update.revision) ||
      update.revision < 0
    )
      return false;
    if (
      !STATES.has(update.connection) ||
      !AUTHORITY.has(update.authority) ||
      !EVIDENCE.has(update.evidenceClass)
    )
      return false;
    if (
      update.observedAt !== null &&
      (!Number.isSafeInteger(update.observedAt) || update.observedAt < 0)
    )
      return false;
    if (
      typeof update.label !== "string" ||
      update.label.length > 4096 ||
      typeof update.simulated !== "boolean"
    )
      return false;
    if (update.simulated && update.evidenceClass !== "synthetic_component")
      return false;
    if (
      update.evidenceClass === "retained_local" &&
      (update.observedAt !== null ||
        update.connection !== "unknown" ||
        update.authority !== "unknown" ||
        update.simulated ||
        (update.viewUrl !== null && update.viewUrl !== undefined))
    )
      return false;
    if (
      record &&
      (update.revision <= record.revision ||
        (update.observedAt !== null &&
          record.observedAt !== null &&
          update.observedAt < record.observedAt))
    )
      return false;
    const gap =
      !snapshot &&
      !!record &&
      (record.gap || update.revision !== record.revision + 1);
    const previous = record;
    record = Object.freeze({
      revision: update.revision,
      observedAt: update.observedAt,
      connection: update.connection,
      authority: update.authority,
      evidenceClass: update.evidenceClass,
      label: update.label,
      simulated: update.simulated,
      gap,
      viewUrl: safeViewUrl(update.viewUrl, allowedViewOrigins),
    });
    phase = "ready";
    if (
      previous &&
      (previous.viewUrl !== record.viewUrl ||
        previous.simulated !== record.simulated ||
        previous.evidenceClass !== record.evidenceClass ||
        record.connection !== "online" ||
        record.observedAt === null)
    )
      releaseView();
    return true;
  }
  function state() {
    let freshness = "unknown";
    const now = /** @type {()=>number} */ (clock)();
    if (
      record &&
      record.observedAt !== null &&
      Number.isSafeInteger(now) &&
      now >= record.observedAt
    ) {
      freshness = now - record.observedAt > maxAgeMs ? "stale" : "fresh";
    }
    const status =
      phase !== "ready"
        ? phase
        : /** @type {Readonly<ProjectionRecord>} */ (record).connection ===
            "unsupported"
          ? "unsupported"
          : /** @type {Readonly<ProjectionRecord>} */ (record).connection ===
              "offline"
            ? "offline"
            : /** @type {Readonly<ProjectionRecord>} */ (record).connection ===
                  "unknown" ||
                /** @type {Readonly<ProjectionRecord>} */ (record).gap ||
                freshness === "unknown"
              ? "unknown"
              : freshness === "stale"
                ? "stale"
                : "ready";
    return Object.freeze({
      status,
      identity: target,
      record,
      freshness,
      authority: record?.authority ?? "unknown",
      canExecute: false,
      viewLabel: !record?.viewUrl
        ? "View unavailable"
        : record.simulated
          ? "Simulated view — synthetic component evidence"
          : "View source unverified — adapter qualification required",
    });
  }
  async function refresh() {
    if (disposed || !target) return false;
    if (typeof readSnapshot !== "function") {
      phase = "unsupported";
      return false;
    }
    const previousRead = pendingRead;
    const controller = new AbortController(),
      expectedGeneration = generation,
      request = ++latestRequest;
    pendingRead = controller;
    phase = "loading";
    try {
      previousRead?.abort();
      if (
        controller.signal.aborted ||
        disposed ||
        expectedGeneration !== generation ||
        request !== latestRequest
      )
        return false;
      const update = await readSnapshot(target, { signal: controller.signal });
      if (
        controller.signal.aborted ||
        disposed ||
        expectedGeneration !== generation ||
        request !== latestRequest
      )
        return false;
      if (update === null) {
        phase = record ? "ready" : "empty";
        return true;
      }
      const accepted = merge(update, { snapshot: true });
      if (
        controller.signal.aborted ||
        disposed ||
        expectedGeneration !== generation ||
        request !== latestRequest
      )
        return false;
      phase = record ? "ready" : "error";
      return accepted;
    } catch {
      if (
        !controller.signal.aborted &&
        !disposed &&
        expectedGeneration === generation &&
        request === latestRequest
      )
        phase = "error";
      return false;
    } finally {
      if (pendingRead === controller) pendingRead = null;
    }
  }
  async function view() {
    if (
      disposed ||
      releasingView ||
      pendingView ||
      activeView ||
      state().status !== "ready" ||
      !(/** @type {Readonly<ProjectionRecord>} */ (record).viewUrl) ||
      typeof openPassive !== "function"
    )
      return false;
    const controller = new AbortController(),
      expectedGeneration = generation,
      admittedRecord = record;
    pendingView = controller;
    try {
      const opened = await openPassive(
        Object.freeze({
          identity: target,
          url: /** @type {Readonly<ProjectionRecord>} */ (record).viewUrl,
          mode: "passive",
          simulated: /** @type {Readonly<ProjectionRecord>} */ (record)
            .simulated,
        }),
        { signal: controller.signal },
      );
      if (!opened || typeof opened.close !== "function") return false;
      if (
        controller.signal.aborted ||
        disposed ||
        expectedGeneration !== generation ||
        record !== admittedRecord ||
        state().status !== "ready"
      ) {
        closeView(opened);
        return false;
      }
      activeView = opened;
      return true;
    } catch {
      return false;
    } finally {
      if (pendingView === controller) pendingView = null;
    }
  }
  function dispose() {
    if (disposed) return;
    generation++;
    disposed = true;
    const previousRead = pendingRead;
    pendingRead = null;
    target = null;
    record = null;
    phase = "empty";
    releaseView();
    previousRead?.abort();
  }
  return Object.freeze({ select, merge, state, refresh, view, dispose });
}
