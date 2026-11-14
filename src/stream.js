// Process-local transport coordination, not a runtime wire protocol or authority.
import { createProjection } from "./projection.js";

/** @typedef {{close: () => unknown}} Subscription */
/** @typedef {{signal: AbortSignal, onEvent: (update: unknown) => void, onDisconnect: () => void, onError: (error?: unknown) => void}} Callbacks */
/** @typedef {{clock: () => number, readSnapshot?: (...args: any[]) => any, openPassive?: (...args: any[]) => any, allowedViewOrigins?: string[], maxAgeMs?: number, subscribe?: (identity: Readonly<Record<string, unknown>>, callbacks: Callbacks) => Subscription | Promise<Subscription>, maxBuffered?: number}} StreamOptions */
// The existing projection's provisional adapter boundary is dynamically typed.
/** @type {(options: any) => any} */
const projectionFactory = createProjection;
/** @typedef {{key: string, identity: Readonly<Record<string, unknown>>, projection: any, controller: AbortController, buffer: any[], synchronizing: boolean, closed: boolean, handle: Subscription | null, promise: Promise<boolean> | null}} Session */

/** @param {StreamOptions} options */

export function createStreamProjection(
  {
    subscribe,
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
  /** @type {Session | null} */
  let current = null;
  let disposed = false;
  let cleanupUnknown = false;
  const empty = projectionFactory(options);
  let last = empty.state();
  empty.dispose();

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
      if (current === session) last = Object.freeze({ ...observed, status });
      if (session.handle) {
        const handle = session.handle;
        session.handle = null;
        closeHandle(handle);
      }
    }
  }

  /** @param {Session} session @param {unknown} update */
  function normalized(session, update) {
    // Store only the projection's bounded validated fields, never arbitrary
    // adapter object graphs or raw transport errors.
    const probe = projectionFactory(options);
    try {
      probe.select(session.identity);
      if (!probe.merge(update, { snapshot: true })) return null;
      return Object.freeze({
        version: 1,
        identity: session.identity,
        ...probe.state().record,
      });
    } catch {
      return null;
    } finally {
      probe.dispose();
    }
  }

  /** @param {unknown} identity @returns {Promise<boolean>} */
  function connect(identity) {
    if (disposed || cleanupUnknown) return Promise.resolve(false);
    const projection = projectionFactory(options);
    projection.select(identity);
    let selected;
    try {
      selected = projection.state().identity;
    } catch {
      projection.dispose();
      if (current) stop(current, "unknown");
      return Promise.resolve(false);
    }
    const key = JSON.stringify(
      Object.entries(selected).sort(([a], [b]) => a.localeCompare(b)),
    );
    if (current && !current.closed && current.key === key) {
      projection.dispose();
      return current.promise ?? Promise.resolve(false);
    }
    if (current) stop(current, "offline");
    if (cleanupUnknown) {
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
    const active = () => current === session && !session.closed && !disposed;
    /** @param {unknown} update */
    function onEvent(update) {
      if (!active()) return;
      const value = normalized(session, update);
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
        session.projection.merge(value);
      }
    }
    session.promise = (async () => {
      if (
        typeof subscribe !== "function" ||
        typeof options.readSnapshot !== "function"
      ) {
        stop(session, "unsupported");
        return false;
      }
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
        const refreshed = await projection.refresh();
        if (!active()) return false;
        if (!refreshed) {
          stop(session, projection.state().status);
          return false;
        }
        for (const update of session.buffer) projection.merge(update);
        session.buffer.length = 0;
        session.synchronizing = false;
        return true;
      } catch {
        // A subscription rejection supplies no cleanup receipt. It may have
        // allocated before failing, so do not silently create another stream.
        if (!session.handle) markCleanupUnknown();
        if (active()) stop(session, "error");
        return false;
      }
    })();
    return session.promise;
  }

  function state() {
    let observed = last;
    if (current && !current.closed) {
      try {
        observed = current.projection.state();
      } catch {
        stop(current, "unknown");
        observed = last;
      }
    }
    return Object.freeze({
      ...observed,
      status: cleanupUnknown
        ? "unknown"
        : current && !current.closed && current.synchronizing
          ? "loading"
          : observed.status,
      subscriptionCleanup: cleanupUnknown
        ? "unknown"
        : "no_unconfirmed_unsubscribe",
      buffered: current?.buffer.length ?? 0,
      canExecute: false,
    });
  }
  function disconnect() {
    if (current) stop(current, "offline");
  }
  function dispose() {
    disposed = true;
    disconnect();
  }
  function view() {
    return state().status === "ready" && current && !current.closed
      ? current.projection.view()
      : Promise.resolve(false);
  }
  return Object.freeze({ connect, disconnect, dispose, state, view });
}
