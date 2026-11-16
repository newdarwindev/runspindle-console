// Deterministic, process-local fake. This is neither a wire service nor authority.
import { consoleScenarios } from "./scenarios.js";

const FACETS = Object.freeze([
  "tasks",
  "pinnedHosts",
  "nativeSessions",
  "browsers",
  "leases",
  "traces",
  "artifacts",
  "deliveryReceipts",
]);

/** @param {{clock:()=>number, seed?:number}} options */
export function createFakeConsoleServer({ clock, seed = 1 }) {
  if (typeof clock !== "function" || !Number.isSafeInteger(seed))
    throw new TypeError("clock and deterministic seed required");
  let revision = 1;
  /** @type {any} */ let snapshot = {
    identity: consoleScenarios.identity,
    ...consoleScenarios.observation,
  };
  /** @type {Map<string, any[]>} */ const facets = new Map(
    FACETS.map((name) => [name, []]),
  );
  /** @type {Set<any>} */ const subscribers = new Set();
  /** @type {any[]} */ const calls = [];
  /** @type {string|null} */ let failure = null;
  let disposed = false;
  function assertOpen() {
    if (disposed) throw new Error("fake server disposed");
  }
  /** @param {string} name @param {{signal?:AbortSignal}} [options] */
  function read(name, { signal } = {}) {
    assertOpen();
    if (!FACETS.includes(name)) throw new TypeError("unsupported fake API");
    if (signal?.aborted) return Promise.reject(new Error("aborted"));
    if (failure === name)
      return Promise.reject(new Error("synthetic backend failure"));
    return Promise.resolve(
      Object.freeze({
        status: failure === "all" ? "unknown" : "ready",
        observedAt: clock(),
        evidenceClass: "synthetic_component",
        items: Object.freeze([...(facets.get(name) ?? [])]),
      }),
    );
  }
  /** @param {unknown} _identity @param {{signal?:AbortSignal}} [options] */
  function readSnapshot(_identity, { signal } = {}) {
    assertOpen();
    if (signal?.aborted) return Promise.reject(new Error("aborted"));
    if (failure === "snapshot" || failure === "all")
      return Promise.reject(new Error("synthetic snapshot failure"));
    return Promise.resolve({ ...snapshot });
  }
  /** @param {unknown} _identity @param {any} callbacks */
  function subscribe(_identity, callbacks) {
    assertOpen();
    if (callbacks.signal?.aborted) return Promise.reject(new Error("aborted"));
    const subscriber = { callbacks, closed: false };
    subscribers.add(subscriber);
    return Promise.resolve({
      close() {
        subscriber.closed = true;
        subscribers.delete(subscriber);
      },
    });
  }
  function emit(change = {}) {
    assertOpen();
    const event = {
      ...snapshot,
      revision: ++revision,
      observedAt: clock(),
      ...change,
    };
    snapshot = event;
    for (const subscriber of subscribers)
      subscriber.callbacks.onEvent({ ...event });
    return event;
  }
  /** @param {any} event */
  function replay(event) {
    assertOpen();
    for (const subscriber of subscribers)
      subscriber.callbacks.onEvent({ ...event });
  }
  /** @param {string} name @param {any} item */
  function put(name, item) {
    assertOpen();
    if (!FACETS.includes(name)) throw new TypeError("unsupported fake API");
    facets.set(name, [...(facets.get(name) ?? []), Object.freeze({ ...item })]);
  }
  function disconnect() {
    for (const subscriber of subscribers) subscriber.callbacks.onDisconnect();
  }
  /** @param {any} request */
  function control(request) {
    assertOpen();
    calls.push(Object.freeze({ ...request }));
    return Promise.resolve({
      status: "denied",
      evidenceClass: "synthetic_component",
    });
  }
  /** @param {any} request */
  function openPassive(request) {
    assertOpen();
    if (request?.mode !== "passive")
      throw new TypeError("passive admission only");
    return Promise.resolve({ close() {} });
  }
  function dispose() {
    disposed = true;
    subscribers.clear();
    facets.clear();
  }
  return Object.freeze({
    seed,
    facets: FACETS,
    read,
    readSnapshot,
    subscribe,
    emit,
    replay,
    put,
    disconnect,
    control,
    openPassive,
    calls,
    dispose,
    /** @param {string|null} name */
    fail: (name) => {
      failure = name;
    },
  });
}
