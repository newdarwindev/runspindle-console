// Application-invoked retained-head observation. No autonomous polling or authority.
import { performance } from "node:perf_hooks";
import { createRetainedHeadReader } from "./retained-snapshot.js";
import { createStreamProjection } from "./stream.js";

/** @typedef {{task:string,host:string,workspace:string}} Identity */
/** @typedef {ReturnType<import('./retained-snapshot.js').createRetainedHeadDecoder> extends {finish:()=>infer R} ? R : never} RecordValue */
/** @param {{source:string,database:string,identity:Identity,python?:string,timeoutMs?:number,maxReads?:number,lifetimeMs?:number}} options */
export function createRetainedStream(options) {
  const { maxReads = 32, lifetimeMs = 30000 } = options;
  if (
    !Number.isSafeInteger(maxReads) ||
    maxReads < 1 ||
    maxReads > 256 ||
    !Number.isSafeInteger(lifetimeMs) ||
    lifetimeMs < 1 ||
    lifetimeMs > 300000
  )
    throw new TypeError("invalid retained observation bounds");
  // The strict decoder validates the configured identity before any child exists.
  const reader = createRetainedHeadReader(options);
  const selected = Object.freeze({ ...options.identity });
  let reads = 0,
    busy = false,
    terminal = false,
    gap = false;
  let reason = "idle";
  let expires = Infinity;
  /** @type {RecordValue|null} */
  let last = null;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let deadline = null;
  /** @type {import('./stream.js').Callbacks|null} */
  let callbacks = null;
  /** @type {AbortController|null} */
  let readController = null;

  /** @param {string} why */
  function end(why) {
    if (!terminal) reason = why;
    terminal = true;
    if (deadline !== null) clearTimeout(deadline);
    deadline = null;
    readController?.abort();
    stream.disconnect();
  }
  /** @param {unknown} target @param {{signal?:AbortSignal}} request */
  async function read(target, { signal } = {}) {
    if (performance.now() >= expires) end("lifetime_limit");
    if (terminal || busy || reads >= maxReads)
      throw new Error("retained observation unavailable");
    busy = true;
    reads++;
    const controller = new globalThis.AbortController();
    readController = controller;
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    try {
      const value = /** @type {RecordValue} */ (
        await reader(target, { signal: controller.signal })
      );
      if (performance.now() >= expires) end("lifetime_limit");
      if (terminal || controller.signal.aborted)
        throw new Error("retained observation stopped");
      if (
        last &&
        (value.revision < last.revision ||
          (value.revision === last.revision &&
            JSON.stringify(value) !== JSON.stringify(last)))
      )
        throw new Error("retained observation regressed");
      gap ||= last !== null && value.revision > last.revision + 1;
      last = value;
      return value;
    } finally {
      signal?.removeEventListener("abort", abort);
      if (readController === controller) readController = null;
      busy = false;
    }
  }
  const stream = createStreamProjection({
    clock: () => 0, // Not an observation timestamp: retained records carry null.
    maxBuffered: 1,
    readSnapshot: read,
    subscribe: (_identity, next) => {
      callbacks = next;
      return {
        close() {
          if (callbacks === next) callbacks = null;
          if (reader.state().pending || reader.state().cleanup === "unknown")
            throw new Error("retained child cleanup unconfirmed");
        },
      };
    },
  });
  async function connect() {
    if (performance.now() >= expires) end("lifetime_limit");
    if (terminal || busy || reader.state().cleanup === "unknown") return false;
    if (reads >= maxReads) {
      end("read_limit");
      return false;
    }
    if (deadline === null) {
      expires = performance.now() + lifetimeMs;
      deadline = setTimeout(() => end("lifetime_limit"), lifetimeMs);
    }
    const ok = await stream.connect(selected);
    if (!terminal) reason = ok ? "observing_retained" : "unavailable";
    if (reader.state().cleanup === "unknown") end("cleanup_unknown");
    return ok;
  }
  async function poll() {
    const next = callbacks;
    if (terminal || busy || !next) return false; // Backpressure: no queue or extra child.
    if (reads >= maxReads) {
      end("read_limit");
      return false;
    }
    try {
      const value = await read(selected, { signal: next.signal });
      if (terminal || callbacks !== next || next.signal.aborted) return false;
      next.onEvent(value);
      return true;
    } catch {
      if (!terminal) reason = "unavailable";
      next.onError();
      if (reader.state().cleanup === "unknown") end("cleanup_unknown");
      return false;
    }
  }
  function disconnect() {
    reason = "disconnected";
    stream.disconnect();
    if (reader.state().cleanup === "unknown") end("cleanup_unknown");
  }
  return Object.freeze({
    connect,
    poll,
    disconnect,
    revoke: () => end("revoked"),
    dispose: () => end("disposed"),
    state: () =>
      Object.freeze({
        ...stream.state(),
        retained: Object.freeze({
          reads,
          pending: busy,
          queued: 0,
          gap,
          reason,
          terminal,
          cleanup: reader.state().cleanup,
          history: "latest_head_only",
        }),
      }),
  });
}
