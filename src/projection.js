/* global AbortController, clearTimeout, performance, setTimeout */

// Provisional, process-local console API. This is not a shared wire protocol.
/** @typedef {Record<string, unknown>} ProjectionIdentity */
/** @typedef {{artifactId?:string, artifactRevision?:number, artifactAcceptance?:string, artifactDelivery?:string, deliveryOperation?:string}} ArtifactObservation */
/** @typedef {{revision:number, observedAt:number|null, connection:string, authority:string, evidenceClass:string, label:string, simulated:boolean, gap:boolean, viewUrl:string|null} & ArtifactObservation} ProjectionRecord */
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
const ARTIFACT_ACCEPTANCE = new Set(["unknown", "accepted"]);
const ARTIFACT_DELIVERY = new Set(["unknown", "reserved", "delivered"]);
const ARTIFACT_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** @param {any} update @param {ProjectionIdentity} target @returns {ArtifactObservation | null} */
function artifactObservation(update, target) {
  const {
    artifactId,
    artifactRevision,
    artifactAcceptance,
    artifactDelivery,
    deliveryOperation,
  } = update;
  if (
    [
      artifactId,
      artifactRevision,
      artifactAcceptance,
      artifactDelivery,
      deliveryOperation,
    ].every((value) => value === undefined)
  )
    return {};
  const acceptance =
    artifactAcceptance === undefined ? "unknown" : artifactAcceptance;
  const delivery =
    artifactDelivery === undefined ? "unknown" : artifactDelivery;
  if (
    !target.artifactDigest ||
    typeof artifactId !== "string" ||
    !ARTIFACT_TOKEN.test(artifactId) ||
    !Number.isSafeInteger(artifactRevision) ||
    artifactRevision < 1 ||
    !ARTIFACT_ACCEPTANCE.has(acceptance) ||
    !ARTIFACT_DELIVERY.has(delivery)
  )
    return null;
  if (
    deliveryOperation === undefined
      ? delivery !== "unknown"
      : acceptance !== "accepted" ||
        typeof deliveryOperation !== "string" ||
        !ARTIFACT_TOKEN.test(deliveryOperation)
  )
    return null;
  return {
    artifactId,
    artifactRevision,
    artifactAcceptance: acceptance,
    artifactDelivery: delivery,
    deliveryOperation,
  };
}

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

/** @param {unknown} value @param {readonly string[]} allowedOrigins */
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

// Branded server-revocation handles are separate from local void-close handles.
/** @typedef {{viewId:string, admissionId:string}} ViewBinding */
/** @typedef {{viewId:string, admissionId:string, status:string, proof:string}} ClosureReceipt */
/** @typedef {(binding:Readonly<ViewBinding>, receipt:Readonly<ClosureReceipt>, options:{signal:AbortSignal})=>unknown} ReceiptVerifier */
/** @type {WeakMap<object, () => Promise<void>>} */
const closes = new WeakMap();

/** @param {unknown} value */
function opaque(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
}

/** @param {unknown} handle */
function takeServerClose(handle) {
  if (typeof handle !== "object" || handle === null) return undefined;
  const close = closes.get(handle);
  closes.delete(handle);
  return close;
}

/**
 * Build a handle for an already authorized passive view. The trusted adapter
 * owns network routing and verifies the exact remote receipt. No input transport
 * is exposed by this handle.
 * @param {ViewBinding} binding
 * @param {{
 *   revoke:(binding:Readonly<ViewBinding>, options:{signal:AbortSignal})=>unknown,
 *   verifyReceipt:ReceiptVerifier,
 *   timeoutMs?:number,
 * }} ports
 */
export function createServerRevocationHandle(binding, ports) {
  const { viewId, admissionId } = binding;
  const { revoke, verifyReceipt, timeoutMs = 5000 } = ports;
  if (
    !opaque(viewId) ||
    !opaque(admissionId) ||
    typeof revoke !== "function" ||
    typeof verifyReceipt !== "function" ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 30_000
  ) {
    throw new TypeError("invalid passive revocation configuration");
  }
  const bound = Object.freeze({ viewId, admissionId });
  const handle = Object.freeze({});
  /** @type {Promise<void>|undefined} */
  let pending;
  closes.set(handle, () => {
    pending ??= revokeWithDeadline(bound, revoke, verifyReceipt, timeoutMs);
    return pending;
  });
  return handle;
}

/**
 * @param {Readonly<ViewBinding>} binding
 * @param {(binding:Readonly<ViewBinding>, options:{signal:AbortSignal})=>unknown} revoke
 * @param {ReceiptVerifier} verifyReceipt
 * @param {number} timeoutMs
 */
async function revokeWithDeadline(binding, revoke, verifyReceipt, timeoutMs) {
  const controller = new AbortController();
  const expires = performance.now() + timeoutMs;
  const expired = () =>
    controller.signal.aborted || performance.now() >= expires;
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("passive revocation unconfirmed"));
      controller.abort();
    }, timeoutMs);
  });
  const verify = Promise.resolve().then(async () => {
    const result = await revoke(binding, { signal: controller.signal });
    if (expired()) throw new Error("passive revocation unconfirmed");
    const response = /** @type {Partial<ClosureReceipt>|null} */ (result);
    const receipt = Object.freeze({
      viewId: response?.viewId,
      admissionId: response?.admissionId,
      status: response?.status,
      proof: response?.proof,
    });
    if (
      receipt.viewId !== binding.viewId ||
      receipt.admissionId !== binding.admissionId ||
      receipt.status !== "revoked" ||
      typeof receipt.proof !== "string" ||
      receipt.proof.length === 0 ||
      receipt.proof.length > 4096 ||
      (await verifyReceipt(binding, /** @type {ClosureReceipt} */ (receipt), {
        signal: controller.signal,
      })) !== true ||
      expired()
    ) {
      throw new Error("passive revocation unconfirmed");
    }
  });
  try {
    await Promise.race([verify, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** @typedef {{controller:AbortController, invalidated:boolean, close:(()=>unknown)|null, server:boolean}} PassiveSlot */

// One resource owner survives task changes and stream projection replacement.
// Abort is a cancellation request, not a receipt that acquisition did not occur.
function createPassiveOwner() {
  let slot = /** @type {PassiveSlot|null} */ (null);
  let unknown = false,
    releasing = 0;
  function blocked() {
    return unknown || releasing > 0 || slot !== null;
  }
  /** @param {AbortController} controller */
  function reserve(controller) {
    if (blocked()) return null;
    slot = { controller, invalidated: false, close: null, server: false };
    return slot;
  }
  /** @param {PassiveSlot} token @param {()=>unknown} close */
  function awaitRevocation(token, close) {
    // The slot remains reserved until the trusted adapter confirms closure.
    void Promise.resolve()
      .then(close)
      .then(
        () => {
          if (slot === token) slot = null;
        },
        () => {
          unknown = true;
          if (slot === token) slot = null;
        },
      );
  }
  /** @param {PassiveSlot} token */
  function release(token) {
    token.invalidated = true;
    releasing++;
    try {
      token.controller.abort();
    } catch {
      unknown = true;
    } finally {
      const close = token.close;
      token.close = null;
      if (close && token.server) {
        awaitRevocation(token, close);
      } else if (close) {
        try {
          // The synchronous void-close contract confirms local cleanup only.
          // A plain promise cannot confirm server-side revocation.
          const result = close();
          if (result !== undefined) {
            unknown = true;
            void Promise.resolve(result).catch(() => {});
          }
        } catch {
          unknown = true;
        } finally {
          if (slot === token) slot = null;
        }
      }
      releasing--;
    }
  }
  /** @param {PassiveSlot} token */
  function fail(token) {
    unknown = true;
    release(token);
    if (slot === token) slot = null;
  }
  /** @param {PassiveSlot} token @param {any} handle */
  function acquired(token, handle) {
    const confirmed = takeServerClose(handle);
    if (confirmed) {
      token.server = true;
      token.close = confirmed;
      return true;
    }
    const close = handle?.close;
    if (typeof close !== "function") {
      fail(token);
      return false;
    }
    token.close = () => close.call(handle);
    return true;
  }
  return Object.freeze({
    blocked,
    reserve,
    release,
    fail,
    acquired,
    /** @param {PassiveSlot} token */
    owns: (token) => slot === token,
    cleanup: () =>
      unknown || releasing || slot?.invalidated
        ? "unknown"
        : "no_unconfirmed_close",
  });
}

/**
 * A private ownership scope for projections sharing one passive adapter.
 * Stream task replacement must use this factory, not reset unresolved ownership.
 * Server-side closure requires a verified receipt from the trusted passive adapter.
 * @param {ProjectionOptions} options
 */
export function createProjectionFactory(options = {}) {
  const { allowedViewOrigins = [] } = options;
  if (!Array.isArray(allowedViewOrigins))
    throw new TypeError("invalid allowed origins");
  const viewOrigins = Object.freeze([...allowedViewOrigins]);
  if (
    viewOrigins.some(
      (origin) =>
        typeof origin !== "string" ||
        safeViewUrl(origin, [origin]) !== `${origin}/`,
    )
  )
    throw new TypeError("invalid allowed origins");
  const views = createPassiveOwner();
  return Object.freeze(
    Object.assign(() => createScopedProjection(options, views, viewOrigins), {
      viewCleanup: views.cleanup,
    }),
  );
}

/** @param {ProjectionOptions} options */
export function createProjection(options = {}) {
  return createProjectionFactory(options)();
}

/** @param {ProjectionOptions} options @param {ReturnType<typeof createPassiveOwner>} views @param {readonly string[]} viewOrigins */
function createScopedProjection(
  { clock, readSnapshot, openPassive, maxAgeMs = 30_000 } = {},
  views,
  viewOrigins,
) {
  if (
    typeof clock !== "function" ||
    !Number.isSafeInteger(maxAgeMs) ||
    maxAgeMs <= 0
  )
    throw new TypeError("invalid clock or age");
  let target = /** @type {Readonly<ProjectionIdentity>|null} */ (null),
    generation = 0,
    latestRequest = 0,
    phase = "empty",
    record = /** @type {Readonly<ProjectionRecord>|null} */ (null);
  let pendingRead = /** @type {AbortController|null} */ (null),
    ownedView = /** @type {PassiveSlot|null} */ (null),
    disposed = false;

  function releaseView() {
    const token = ownedView;
    ownedView = null;
    if (token) views.release(token);
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
    const artifact = artifactObservation(update, incoming);
    if (artifact === null) return false;
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
      viewUrl: safeViewUrl(update.viewUrl, viewOrigins),
      ...artifact,
    });
    phase = "ready";
    if (
      previous &&
      (previous.viewUrl !== record.viewUrl ||
        previous.simulated !== record.simulated ||
        previous.evidenceClass !== record.evidenceClass ||
        previous.authority !== record.authority ||
        record.connection !== "online" ||
        record.observedAt === null ||
        record.gap)
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
      viewCleanup: views.cleanup(),
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
      views.blocked() ||
      state().status !== "ready" ||
      !(/** @type {Readonly<ProjectionRecord>} */ (record).viewUrl) ||
      typeof openPassive !== "function"
    )
      return false;
    const controller = new AbortController(),
      expectedGeneration = generation,
      admittedRecord = record;
    const token = views.reserve(controller);
    if (!token) return false;
    ownedView = token;
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
      if (!views.acquired(token, opened)) return false;
      // The injected clock can reenter selection/disposal while computing state.
      // Recheck every admission fence after that callback-bearing observation.
      const ready = state().status === "ready";
      if (
        token.invalidated ||
        controller.signal.aborted ||
        disposed ||
        expectedGeneration !== generation ||
        record !== admittedRecord ||
        !views.owns(token) ||
        !ready
      ) {
        views.release(token);
        return false;
      }
      return true;
    } catch {
      // Rejection or malformed acquisition gives no proof of non-allocation.
      // If a handle is already known, close it before discarding ownership.
      if (token.close) views.release(token);
      else views.fail(token);
      return false;
    } finally {
      if (ownedView === token && !views.owns(token)) ownedView = null;
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
  return Object.freeze({
    select,
    merge,
    state,
    observation: () => record,
    refresh,
    view,
    dispose,
  });
}
