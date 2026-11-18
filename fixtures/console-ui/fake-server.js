// Bounded process-local synthetic backend. No socket, credential, or real control.
import { consoleScenarios } from "./scenarios.js";

/** @typedef {Readonly<Record<string,unknown>>} Identity */
/** @typedef {{identity:Identity,status:string,observedAt:number|null,revision:number,evidenceClass:string,items:Record<string,unknown>[]}} Facet */
/** @typedef {{signal?:AbortSignal,onEvent:(event:Record<string,unknown>)=>void,onDisconnect:()=>void,onError?:(error?:unknown)=>void}} Subscriber */
/** @typedef {{state:string,identity:Identity,revision:number,observedAt:number|null,evidenceClass:string,canTakeover:boolean,canRelease:boolean,canExecute:false}} Authority */
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
const FACET_STATES = new Set([
  "empty",
  "loading",
  "error",
  "unsupported",
  "unknown",
  "offline",
  "stale",
  "ready",
]);
/** @template T @param {T} value @returns {T} */
function fixtureCopy(value) {
  const text = JSON.stringify(value);
  if (text.length > 65536)
    throw new TypeError("bounded fixture value required");
  const clone = JSON.parse(text);
  /** @param {unknown} item */
  function freeze(item) {
    if (item && typeof item === "object") {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
  }
  freeze(clone);
  return clone;
}
/** @param {unknown} left @param {Identity} right */
function fixtureIdentityMatches(left, right) {
  if (!left || typeof left !== "object" || Array.isArray(left)) return false;
  const keys = Object.keys(right);
  return (
    Object.keys(left).length === keys.length &&
    keys.every(
      (key) =>
        Object.hasOwn(left, key) &&
        /** @type {Record<string,unknown>} */ (left)[key] === right[key],
    )
  );
}

/** @param {{clock:()=>number,seed?:number,identity?:Identity,secrets?:string[],capacity?:number}} options */
export function createFakeConsoleServer({
  clock,
  seed = 1,
  identity = consoleScenarios.identity,
  secrets = [],
  capacity = 128,
}) {
  if (
    typeof clock !== "function" ||
    !Number.isSafeInteger(seed) ||
    !Number.isSafeInteger(capacity) ||
    capacity < 1 ||
    capacity > 1024
  )
    throw new TypeError("bounded fixture configuration required");
  const bound = fixtureCopy(identity);
  if (
    ["task", "host", "workspace"].some(
      (key) => typeof bound[key] !== "string",
    ) ||
    JSON.stringify(bound).length > 4096 ||
    secrets.some((secret) => !secret || JSON.stringify(bound).includes(secret))
  )
    throw new TypeError("clean bound identity required");
  function now() {
    const value = clock();
    if (!Number.isSafeInteger(value) || value < 0)
      throw new TypeError("invalid fixture clock");
    return value;
  }
  /** @param {string} value */
  function clean(value) {
    if (value.length > 4096) throw new TypeError("fixture text limit");
    for (const secret of secrets)
      value = value.replaceAll(secret, "[REDACTED]");
    return value;
  }
  let revision = 1,
    disposed = false,
    viewer = "simulated",
    closureFailure = false;
  let authorityState = "denied",
    authorityRevision = 1,
    authorityTime = now();
  /** @type {Record<string,unknown>} */
  let snapshot = fixtureCopy({
    identity: bound,
    ...consoleScenarios.observation,
    observedAt: now(),
  });
  /** @type {Map<string,Facet>} */
  const facets = new Map(
    FACETS.map((name) => [
      name,
      {
        identity: bound,
        status: "empty",
        observedAt: now(),
        revision: 1,
        evidenceClass: "synthetic_component",
        items: [],
      },
    ]),
  );
  /** @type {Set<Subscriber>} */ const subscribers = new Set();
  /** @type {Readonly<Record<string,unknown>>[]} */ const controls = [];
  /** @type {Readonly<Record<string,unknown>>[]} */ const passive = [];
  /** @type {Map<string,{request:string,receipt:Authority}>} */ const controlReceipts =
    new Map();
  /** @type {Map<string,{promise:Promise<void>,release:()=>void}>} */ const delays =
    new Map();
  /** @type {Set<()=>void>} */ const waiting = new Set();
  let requestSequence = 0;
  function allocateRequestId() {
    assertOpen();
    if (requestSequence >= capacity) throw Error("request identity capacity");
    return `fixture-request-${++requestSequence}`;
  }
  /** @type {Set<()=>void>} */ const closes = new Set();
  /** @type {string|null} */ let failure = null;
  function assertOpen() {
    if (disposed) throw Error("fake server disposed");
  }
  /** @param {unknown} target */ function checkTarget(target) {
    assertOpen();
    if (!fixtureIdentityMatches(target, bound))
      throw TypeError("wrong synthetic target/session/epoch");
  }
  /** @param {string} name @param {AbortSignal} [signal] */
  async function wait(name, signal) {
    if (signal?.aborted) throw Error("aborted");
    const delay = delays.get(name);
    if (delay) {
      delays.delete(name);
      await new Promise((resolve, reject) => {
        let settled = false;
        function finish(aborted = false) {
          if (settled) return;
          settled = true;
          signal?.removeEventListener("abort", cancel);
          waiting.delete(cancel);
          if (aborted) reject(Error("aborted"));
          else resolve(undefined);
        }
        function cancel() {
          finish(true);
        }
        waiting.add(cancel);
        signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) cancel();
        void delay.promise.then(() => finish());
      });
    }
    assertOpen();
    if (signal?.aborted) throw Error("aborted");
  }

  /** @param {string} name @param {{signal?:AbortSignal,identity?:Identity}} [options] */
  async function read(name, { signal, identity: target = bound } = {}) {
    checkTarget(target);
    if (!FACETS.includes(name)) throw TypeError("unsupported fake API");
    const captured = fixtureCopy(facets.get(name));
    await wait(name, signal);
    if (failure === name) throw Error("synthetic backend failure");
    if (!captured) throw Error("missing facet");
    return fixtureCopy({
      ...captured,
      status: failure === "all" ? "unknown" : captured.status,
    });
  }
  /** @param {unknown} target @param {{signal?:AbortSignal}} [options] */
  async function readSnapshot(target, { signal } = {}) {
    checkTarget(target);
    const captured = fixtureCopy(snapshot);
    await wait("snapshot", signal);
    if (failure === "snapshot" || failure === "all")
      throw Error("synthetic snapshot failure");
    return captured;
  }
  /** @param {unknown} target @param {Subscriber} callbacks */
  function subscribe(target, callbacks) {
    checkTarget(target);
    if (callbacks.signal?.aborted) throw Error("aborted");
    if (subscribers.size >= capacity) throw Error("subscription capacity");
    subscribers.add(callbacks);
    return {
      close() {
        subscribers.delete(callbacks);
      },
    };
  }
  /** @param {Record<string,unknown>} [change] */
  function emit(change = {}) {
    assertOpen();
    const event = fixtureCopy({
      ...snapshot,
      revision: ++revision,
      observedAt: now(),
      ...change,
      ...(typeof change.label === "string"
        ? { label: clean(change.label) }
        : {}),
    });
    snapshot = event;
    for (const sub of subscribers) sub.onEvent(fixtureCopy(event));
    return event;
  }
  /** @param {Record<string,unknown>} event */
  function replay(event) {
    assertOpen();
    for (const sub of subscribers) sub.onEvent(fixtureCopy(event));
  }
  /** @param {string} name @param {Record<string,unknown>} item */
  function put(name, item) {
    assertOpen();
    const old = facets.get(name);
    if (!old) throw TypeError("unsupported fake API");
    if (old.items.length >= capacity) throw Error("facet capacity");
    if (
      typeof item.id !== "string" ||
      !item.id ||
      item.id.length > 256 ||
      secrets.some((secret) => /** @type {string} */ (item.id).includes(secret))
    )
      throw TypeError("clean record identity required");
    const record = {
      id: item.id,
      label: clean(
        typeof item.label === "string" ? item.label : "Synthetic record",
      ),
      identity: bound,
      delivery:
        item.delivery === "confirmed" ? "synthetic_confirmed" : "unknown",
      artifactDigest:
        typeof item.artifactDigest === "string" &&
        /^sha256:[a-f0-9]{64}$/.test(item.artifactDigest)
          ? item.artifactDigest
          : null,
    };
    facets.set(name, {
      ...old,
      status: "ready",
      revision: old.revision + 1,
      observedAt: now(),
      items: [...old.items, fixtureCopy(record)],
    });
  }
  /** @param {string} name @param {string} status @param {number|null} [observedAt] */
  function setFacet(name, status, observedAt = now()) {
    assertOpen();
    const old = facets.get(name);
    if (!old || !FACET_STATES.has(status))
      throw TypeError("invalid facet state");
    if (
      observedAt !== null &&
      (!Number.isSafeInteger(observedAt) || observedAt < 0)
    )
      throw TypeError("invalid observation time");
    facets.set(name, {
      ...old,
      status,
      observedAt,
      revision: old.revision + 1,
    });
  }
  /** @returns {Authority} */
  function authority() {
    assertOpen();
    const fresh =
      Number.isSafeInteger(authorityTime) &&
      0 <= now() - authorityTime &&
      now() - authorityTime <= 30;
    return fixtureCopy({
      state: fresh ? authorityState : "unknown",
      identity: bound,
      revision: authorityRevision,
      observedAt: authorityTime,
      evidenceClass: "synthetic_component",
      canTakeover: fresh && ["denied", "agent"].includes(authorityState),
      canRelease: fresh && authorityState === "human" && !closureFailure,
      canExecute: false,
    });
  }
  /** @param {string} state */
  function decide(state) {
    assertOpen();
    if (
      ![
        "pending",
        "denied",
        "human",
        "agent",
        "unknown",
        "handback_pending",
      ].includes(state)
    )
      throw TypeError("invalid synthetic authority");
    authorityState = state;
    authorityRevision++;
    authorityTime = now();
    return authority();
  }
  /** @param {{identity:Identity,action:string,requestId:string}} request @param {{signal?:AbortSignal}} [options] */
  async function control(request, { signal } = {}) {
    if (signal?.aborted) throw Error("aborted");
    checkTarget(request.identity);
    if (!/^[A-Za-z0-9-]{1,64}$/.test(request.requestId))
      throw TypeError("invalid request identity");
    if (!["takeover", "release"].includes(request.action))
      throw TypeError("unsupported synthetic control");
    const previous = controlReceipts.get(request.requestId);
    if (previous) {
      if (previous.request !== JSON.stringify(request))
        throw TypeError("conflicting request reuse");
      return fixtureCopy(previous.receipt);
    }
    if (controls.length >= capacity) throw Error("control fixture capacity");
    const before = authority();
    controls.push(fixtureCopy(request));
    if (request.action === "takeover" && before.canTakeover) decide("pending");
    else if (request.action === "release" && before.canRelease)
      decide("handback_pending");
    const receipt = authority();
    controlReceipts.set(request.requestId, {
      request: JSON.stringify(request),
      receipt,
    });
    await wait("control", signal);
    return fixtureCopy(receipt);
  }
  /** @param {{identity:Identity,mode:string,url?:unknown,simulated?:unknown}} request @param {{signal?:AbortSignal}} [options] */
  async function openPassive(request, { signal } = {}) {
    checkTarget(request.identity);
    if (
      request.mode !== "passive" ||
      viewer !== "simulated" ||
      request.simulated !== true ||
      request.url !== "https://viewer.invalid/passive"
    )
      throw TypeError("passive admission unavailable");
    if (passive.length >= capacity) throw Error("passive fixture capacity");
    passive.push(fixtureCopy(request));
    let closed = false;
    const close = () => {
      if (closed) return;
      if (closureFailure) throw Error("synthetic closure unconfirmed");
      closed = true;
      closes.delete(close);
    };
    closes.add(close);
    try {
      await wait("passive", signal);
    } catch (error) {
      close();
      throw error;
    }
    return { frame: "SIMULATED — synthetic workspace, no live pixels", close };
  }
  /** @param {string} state @param {boolean} [failClose] */
  function setViewer(state, failClose = false) {
    if (
      !["simulated", "unavailable", "unauthorized", "disconnected"].includes(
        state,
      )
    )
      throw TypeError("invalid viewer fixture");
    viewer = state;
    closureFailure = failClose;
  }
  /** @param {string} name */
  function deferNext(name) {
    assertOpen();
    if (delays.has(name) || delays.size + waiting.size >= capacity)
      throw Error("delay capacity");
    /** @type {()=>void} */ let release = () => {};
    const promise = new Promise((resolve) => {
      release = () => {
        if (delays.get(name)?.promise === promise) delays.delete(name);
        resolve(undefined);
      };
    });
    delays.set(name, { promise, release });
    return release;
  }
  function disconnect() {
    for (const sub of [...subscribers]) sub.onDisconnect();
  }
  function dispose() {
    if (disposed) return;
    for (const cancel of [...waiting]) cancel();
    for (const pending of delays.values()) pending.release();
    for (const close of [...closes]) {
      try {
        close();
      } catch {}
    }
    subscribers.clear();
    disposed = true;
  }
  return Object.freeze({
    seed,
    identity: bound,
    facets: FACETS,
    read,
    readSnapshot,
    subscribe,
    emit,
    replay,
    put,
    setFacet,
    authority,
    decide,
    control,
    allocateRequestId,
    openPassive,
    setViewer,
    deferNext,
    disconnect,
    dispose,
    get calls() {
      return fixtureCopy(controls);
    },
    get passiveCalls() {
      return fixtureCopy(passive);
    },
    get resources() {
      return Object.freeze({
        subscriptions: subscribers.size,
        viewers: closes.size,
        delays: delays.size + waiting.size,
      });
    },
    /** @param {string|null} name */ fail: (name) => {
      failure = name;
    },
  });
}
