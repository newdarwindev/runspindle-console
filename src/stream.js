// Process-local transport coordination, not a runtime wire protocol or authority.
import { createProjectionFactory } from "./projection.js";

/** @typedef {{close: () => unknown}} Subscription */
/** @typedef {{signal: AbortSignal, onEvent: (update: unknown) => void, onDisconnect: () => void, onError: (error?: unknown) => void}} Callbacks */
/** @typedef {{clock: () => number, readSnapshot?: (...args: any[]) => any, openPassive?: (...args: any[]) => any, allowedViewOrigins?: string[], maxAgeMs?: number, viewOpenTimeoutMs?: number, subscribe?: (identity: Readonly<Record<string, unknown>>, callbacks: Callbacks) => Subscription | Promise<Subscription>, maxBuffered?: number}} StreamOptions */
/** @typedef {{key: string, identity: Readonly<Record<string, unknown>>, projection: any, controller: AbortController, buffer: Observation[], synchronizing: boolean, closed: boolean, handle: Subscription | null, promise: Promise<boolean> | null}} Session */
/** @typedef {Readonly<import('./projection.js').ProjectionRecord>} Observation */
/** @typedef {{record:Observation, observedAt:number|null}} Checkpoint */

const MAX_TRACKED_IDENTITIES = 128;

/** @param {StreamOptions} options */

export function createStreamProjection(
  {
    subscribe,
    readSnapshot,
    maxBuffered = 64,
    ...options
  } = /** @type {StreamOptions} */ ({}),
) {
  if (
    !Number.isSafeInteger(maxBuffered) ||
    maxBuffered < 1 ||
    maxBuffered > 1024
  ) {
    throw new TypeError("invalid buffer bound");
  }
  // Pending/uncertain passive resources outlive an individual task projection.
  // Preserve the existing dynamically typed provisional projection boundary.
  /** @type {(() => any) & {viewCleanup: () => string}} */
  const projectionFactory = createProjectionFactory({
    ...options,
    readSnapshot: checkedSnapshot,
  });
  /** @type {Map<string, Checkpoint>} */
  const checkpoints = new Map();
  /** @type {Session | null} */
  let current = null;
  /** @type {Session | null} */
  let pendingAcquisition = null;
  let selectionEpoch = 0;
  let disposed = false;
  let cleanupUnknown = false;
  let tearingDown = false;
  const empty = projectionFactory();
  let last = empty.state();
  empty.dispose();

  /** @param {Checkpoint | undefined} checkpoint @param {Observation} next */
  function conflicts(checkpoint, next) {
    if (!checkpoint || next.revision < checkpoint.record.revision) return false;
    const { record, observedAt } = checkpoint;
    if (next.revision === record.revision) {
      // Gap is derived locally, including when a full snapshot heals it.
      const fields = /** @type {(keyof Observation)[]} */ (Object.keys(record));
      return fields.some((key) => key !== "gap" && record[key] !== next[key]);
    }
    return (
      next.observedAt !== null &&
      observedAt !== null &&
      next.observedAt < observedAt
    );
  }

  /** @param {Session} session @param {Observation} record */
  function retain(session, record) {
    if (disposed) return;
    const prior = checkpoints.get(session.key);
    if (!prior || record.revision > prior.record.revision) {
      checkpoints.set(session.key, {
        record,
        observedAt: record.observedAt ?? prior?.observedAt ?? null,
      });
    }
  }

  /** @param {Readonly<Record<string, unknown>>} target @param {{signal: AbortSignal}} request */
  async function checkedSnapshot(target, request) {
    const session = current;
    if (!session || !readSnapshot) return null;
    const update = await readSnapshot(target, request);
    if (current !== session || session.closed || request.signal.aborted)
      return null;
    const checkpoint = checkpoints.get(session.key);
    const value = update === null ? null : normalized(session, update);
    if (current !== session || session.closed || request.signal.aborted)
      return null;
    if (
      (update !== null && !value) ||
      (checkpoint &&
        (!value ||
          value.revision < checkpoint.record.revision ||
          conflicts(checkpoint, value)))
    ) {
      stop(session, "unknown");
      return null;
    }
    return value && { version: 1, identity: session.identity, ...value };
  }

  function markCleanupUnknown() {
    cleanupUnknown = true;
    if (current && !current.closed) stop(current, "unknown");
  }

  /** @param {Subscription} handle */
  function closeHandle(handle) {
    try {
      // Adapters must expose synchronous, confirmed unsubscribe. Async resource
      // lifecycles require a separately reviewed adapter, not inferred success.
      const result = handle.close();
      if (result !== undefined) {
        if (result instanceof Promise) result.catch(() => {});
        throw new Error("unconfirmed unsubscribe");
      }
    } catch {
      markCleanupUnknown();
    }
  }

  /** @param {Session} session @param {string} status */
  function stop(session, status) {
    if (session.closed) return;
    session.closed = true;
    // Abort listeners, passive cleanup and handle.close are trusted callbacks
    // that can reenter connect before synchronous teardown has finished.
    tearingDown = true;
    let observed = {
      status: "unknown",
      identity: session.identity,
      record: null,
      freshness: "unknown",
      authority: "unknown",
      canExecute: false,
      viewLabel: "View unavailable",
    };
    try {
      session.controller.abort();
      observed = session.projection.state();
    } catch {
      status = "unknown";
    } finally {
      session.buffer.length = 0;
      try {
        session.projection.dispose();
      } catch {
        markCleanupUnknown();
      }
      if (current === session)
        last = Object.freeze({ ...observed, status, freshness: "unknown" });
      if (session.handle) {
        const handle = session.handle;
        session.handle = null;
        closeHandle(handle);
      }
      tearingDown = false;
    }
  }

  /** @param {Session} session @param {unknown} update @returns {Observation|null} */
  function normalized(session, update) {
    // Store only the projection's bounded validated fields, never arbitrary
    // adapter object graphs or raw transport errors.
    const probe = projectionFactory();
    try {
      probe.select(session.identity);
      if (!probe.merge(update, { snapshot: true })) return null;
      return probe.state().record;
    } catch {
      return null;
    } finally {
      probe.dispose();
    }
  }

  /** @param {Session} session @param {Observation} value */
  function mergeEvent(session, value) {
    try {
      session.projection.state();
    } catch {
      stop(session, "unknown");
      return false;
    }
    // Reading state invokes the injected clock, which may reenter navigation.
    if (current !== session || session.closed || disposed) return false;
    if (conflicts(checkpoints.get(session.key), value)) {
      stop(session, "unknown");
      return false;
    }
    if (
      session.projection.merge({
        version: 1,
        identity: session.identity,
        ...value,
      })
    )
      retain(session, value);
    return current === session && !session.closed && !disposed;
  }

  /** @param {unknown} identity @returns {Promise<boolean>} */
  function connect(identity) {
    if (disposed || cleanupUnknown || tearingDown)
      return Promise.resolve(false);
    const selection = ++selectionEpoch;
    const projection = projectionFactory();
    projection.select(identity);
    let initial;
    try {
      initial = projection.state();
    } catch {
      projection.dispose();
      if (selection === selectionEpoch && current) stop(current, "unknown");
      return Promise.resolve(false);
    }
    // Projection state reads the injected clock. A newer selection or a
    // disconnect during that read owns the coordinator now.
    if (selection !== selectionEpoch) {
      projection.dispose();
      return Promise.resolve(false);
    }
    const selected = initial.identity;
    const key = JSON.stringify(
      Object.entries(selected)
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => a.localeCompare(b)),
    );
    if (current && !current.closed && current.key === key) {
      projection.dispose();
      return current.promise ?? Promise.resolve(false);
    }
    if (current) stop(current, "offline");
    // Abort fences callbacks but cannot confirm that a pending acquisition did
    // not allocate. Keep its slot until a valid handle is owned or closed.
    if (
      selection !== selectionEpoch ||
      disposed ||
      cleanupUnknown ||
      pendingAcquisition !== null ||
      (!checkpoints.has(key) && checkpoints.size >= MAX_TRACKED_IDENTITIES)
    ) {
      projection.dispose();
      return Promise.resolve(false);
    }
    /** @type {Session} */
    const session = {
      key,
      identity: selected,
      projection,
      controller: new globalThis.AbortController(),
      buffer: [],
      synchronizing: true,
      closed: false,
      handle: null,
      promise: null,
    };
    current = session;
    last = initial;
    const active = () => current === session && !session.closed && !disposed;
    /** @param {unknown} update */
    function onEvent(update) {
      if (!active()) return;
      const value = normalized(session, update);
      if (!active()) return;
      if (!value) {
        stop(session, "unknown");
        return;
      }
      if (session.synchronizing) {
        if (session.buffer.length >= maxBuffered) {
          stop(session, "unknown");
          return;
        }
        session.buffer.push(value);
      } else {
        mergeEvent(session, value);
      }
    }
    session.promise = (async () => {
      if (
        typeof subscribe !== "function" ||
        typeof readSnapshot !== "function"
      ) {
        stop(session, "unsupported");
        return false;
      }
      pendingAcquisition = session;
      try {
        const handle = await subscribe(selected, {
          signal: session.controller.signal,
          onEvent,
          onDisconnect: () => {
            if (active()) stop(session, "offline");
          },
          onError: () => {
            if (active()) stop(session, "error");
          },
        });
        if (!handle || typeof handle.close !== "function") {
          markCleanupUnknown();
          return false;
        }
        if (!active()) {
          closeHandle(handle);
          return false;
        }
        session.handle = handle;
        pendingAcquisition = null;
        const refreshed = await projection.refresh();
        if (!active()) return false;
        if (!refreshed) {
          stop(session, projection.state().status);
          return false;
        }
        const snapshot = projection.observation();
        if (snapshot) retain(session, snapshot);
        for (const update of session.buffer) {
          if (!mergeEvent(session, update)) return false;
        }
        session.buffer.length = 0;
        session.synchronizing = false;
        return active();
      } catch {
        // A subscription rejection supplies no cleanup receipt. It may have
        // allocated before failing, so do not silently create another stream.
        if (pendingAcquisition === session) markCleanupUnknown();
        if (active()) stop(session, "error");
        return false;
      } finally {
        // A late handle is closed before releasing this slot. Failed/missing
        // cleanup is sticky in cleanupUnknown, even after the promise settles.
        if (pendingAcquisition === session) pendingAcquisition = null;
      }
    })();
    return session.promise;
  }

  function state() {
    const session = current;
    let observed;
    if (session && !session.closed) {
      try {
        observed = session.projection.state();
      } catch {
        if (current === session) stop(session, "unknown");
      }
    }
    // The clock may have replaced the session during this read.
    if (current !== session || session?.closed || !observed) observed = last;
    const unconfirmed =
      cleanupUnknown || tearingDown || !!pendingAcquisition?.closed;
    return Object.freeze({
      ...observed,
      viewCleanup: projectionFactory.viewCleanup(),
      status: unconfirmed
        ? "unknown"
        : current && !current.closed && current.synchronizing
          ? "loading"
          : observed.status,
      subscriptionCleanup: unconfirmed
        ? "unknown"
        : "no_unconfirmed_unsubscribe",
      buffered: current?.buffer.length ?? 0,
      canExecute: false,
    });
  }
  function disconnect() {
    selectionEpoch++;
    if (current) stop(current, "offline");
  }
  function dispose() {
    disposed = true;
    checkpoints.clear();
    disconnect();
  }
  function view() {
    return state().status === "ready" && current && !current.closed
      ? current.projection.view()
      : Promise.resolve(false);
  }
  return Object.freeze({ connect, disconnect, dispose, state, view });
}
