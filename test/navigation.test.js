import test from "node:test";
import { setImmediate } from "node:timers";
import assert from "node:assert/strict";
import {
  createTaskNavigator,
  createBrowserTaskHistory,
} from "../src/navigation.js";
import { createStreamProjection } from "../src/stream.js";
import { ElementDouble } from "./dom-double.js";
import {
  consoleScenarios,
  consoleTaskCatalog,
} from "../fixtures/console-ui/scenarios.js";

function setup() {
  /** @type {any} */ const document = { activeElement: null };
  document.createElement = /** @param {string} tag */ (tag) =>
    new ElementDouble(tag, document);
  const root = document.createElement("main");
  const catalog = [...consoleTaskCatalog];
  /** @type {Array<{identity: any, resolve: (value:any)=>void}>} */ const reads =
    [];
  /** @type {any[]} */ const subscriptions = [];
  let closeCount = 0,
    viewCount = 0;
  const stream = createStreamProjection({
    clock: () => 1000,
    subscribe: (identity, callbacks) => {
      subscriptions.push({ identity, ...callbacks });
      return {
        close: () => {
          closeCount++;
        },
      };
    },
    readSnapshot: (identity) =>
      new Promise((resolve) => reads.push({ identity, resolve })),
    openPassive: () => {
      viewCount++;
    },
  });
  /** @type {Array<string | null>} */ const entries = [null];
  let position = 0,
    historyClosed = 0;
  /** @type {((key:unknown)=>void) | null} */ let listener = null;
  const history = {
    current: () => entries[position],
    push: /** @param {string} key */ (key) => {
      entries.splice(position + 1);
      entries.push(key);
      position++;
    },
    subscribe: /** @param {(key:unknown)=>void} callback */ (callback) => {
      listener = callback;
      return () => {
        historyClosed++;
        listener = null;
      };
    },
  };
  const navigator = createTaskNavigator(root, { catalog, stream, history });
  return {
    document,
    root,
    catalog,
    stream,
    reads,
    subscriptions,
    history,
    entries,
    navigator,
    counts: () => ({ closeCount, viewCount, historyClosed }),
    move: /** @param {number} delta */ (delta) => {
      position += delta;
      listener?.(entries[position]);
    },
    emitHistory: /** @param {unknown} key */ (key) => listener?.(key),
    settle: /** @param {number} index */ (index) => {
      const read = reads[index];
      read.resolve({
        ...consoleScenarios.observation,
        identity: read.identity,
      });
    },
  };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
/** @param {any} f @param {string} key */ const field = (f, key) =>
  f.root.querySelector(`[data-field="${key}"]`).textContent;

test("navigation uses real stream with DOM/history doubles; back/forward fence stale replies", async () => {
  const f = setup();
  const a = f.navigator.navigate("a");
  await tick();
  const b = f.navigator.navigate("b");
  await tick();
  assert.equal(f.counts().closeCount, 1);
  assert.equal(f.subscriptions[0].signal.aborted, true);
  f.settle(0);
  await tick();
  assert.equal(field(f, "task"), "task-b");
  f.settle(1);
  assert.equal(await b, true);
  assert.equal(await a, false);
  assert.equal(field(f, "label"), consoleScenarios.observation.label);
  assert.equal(f.document.activeElement.getAttribute("data-task-key"), "b");
  const count = f.reads.length;
  assert.equal(await f.navigator.navigate("b"), true);
  assert.equal(f.entries.length, 3);
  assert.equal(f.reads.length, count);
  f.move(-1);
  await tick();
  f.settle(2);
  await tick();
  assert.equal(field(f, "task"), "task-a");
  assert.equal(f.document.activeElement.getAttribute("data-task-key"), "a");
  f.move(1);
  await tick();
  f.settle(3);
  await tick();
  assert.equal(field(f, "task"), "task-b");
  assert.equal(f.counts().viewCount, 0);
  f.navigator.dispose();
  assert.equal(f.counts().historyClosed, 1);
  assert.equal(f.counts().closeCount, 4);
});

test("unknown history clears previous task, click listeners work and disposal fences late reads", async () => {
  const f = setup();
  const button = f.root.querySelector('[data-task-key="a"]');
  button.click();
  await tick();
  f.settle(0);
  await tick();
  f.emitHistory("missing");
  assert.equal(field(f, "task"), "Unknown");
  assert.equal(field(f, "label"), "Unknown");
  assert.equal(f.subscriptions[0].signal.aborted, true);
  const pending = f.navigator.navigate("b");
  await tick();
  f.navigator.dispose();
  f.navigator.dispose();
  button.click();
  f.settle(1);
  await pending;
  assert.equal(f.root.children.length, 0);
  assert.equal(f.reads.length, 2);
  assert.equal(f.counts().historyClosed, 1);
  assert.equal(f.navigator.update(), false);
});

test("history push failure has zero new stream effects; no private error rendering", async () => {
  const f = setup();
  const p = f.navigator.navigate("a");
  await tick();
  f.settle(0);
  await p;
  f.history.push = () => {
    throw new Error("SECRET_CANARY");
  };
  assert.equal(await f.navigator.navigate("b"), false);
  assert.equal(f.reads.length, 1);
  assert.equal(field(f, "task"), "task-a");
  assert.ok(!f.root.textContent.includes("SECRET_CANARY"));
  f.navigator.dispose();
});

test("task labels are literal and cleanup runs despite failing history unsubscribe", () => {
  const f = setup();
  f.navigator.dispose();
  let disposed = 0;
  const stream = {
    state: () => ({ status: "empty" }),
    disconnect: () => {},
    dispose: () => {
      disposed++;
    },
  };
  const navigator = createTaskNavigator(f.root, {
    catalog: [{ ...f.catalog[0], label: "<script>synthetic</script>" }],
    stream,
    history: {
      current: () => null,
      push: () => {},
      subscribe: () => () => {
        throw new Error("SECRET_CANARY");
      },
    },
  });
  assert.equal(
    f.root.querySelector("button").textContent,
    "<script>synthetic</script>",
  );
  assert.equal(f.root.querySelector("script"), null);
  navigator.dispose();
  assert.equal(disposed, 1);
  assert.equal(f.root.children.length, 0);
});

test("Browser History adapter preserves other state and only observes popstate; browser double", () => {
  /** @type {any} */ const browser = {
    history: { state: { other: "retained" } },
    handlers: new Set(),
  };
  /** @type {any[]} */ const writes = [];
  browser.history.pushState = /** @param {any[]} args */ (...args) => {
    writes.push(args);
    browser.history.state = args[0];
  };
  browser.addEventListener =
    /** @param {string} _type @param {()=>void} callback */ (_type, callback) =>
      browser.handlers.add(callback);
  browser.removeEventListener =
    /** @param {string} _type @param {()=>void} callback */ (_type, callback) =>
      browser.handlers.delete(callback);
  const history = createBrowserTaskHistory(browser);
  assert.equal(history.current(), null);
  /** @type {unknown[]} */ const seen = [];
  const close = history.subscribe((key) => seen.push(key));
  history.push("a");
  assert.equal(history.current(), "a");
  assert.equal(browser.history.state.other, "retained");
  assert.equal(writes[0].length, 2); // No URL parameter: no navigation target.
  assert.equal(seen.length, 0);
  browser.history.state = { runspindleConsoleTask: "b" };
  for (const handler of browser.handlers) handler();
  assert.deepEqual(seen, ["b"]);
  close();
  assert.equal(browser.handlers.size, 0);
  browser.history.state = "incompatible";
  assert.throws(() => history.push("a"), /incompatible/);
  assert.equal(writes.length, 1);
});

test("refused connection cannot render previous identity under newly selected task", async () => {
  const f = setup();
  const p = f.navigator.navigate("a");
  await tick();
  f.settle(0);
  await p;
  const previous = f.stream.state();
  f.navigator.dispose();
  const stream = {
    state: () => previous,
    connect: () => Promise.resolve(false),
    disconnect: () => {},
    dispose: () => {},
  };
  const navigator = createTaskNavigator(f.root, {
    catalog: f.catalog,
    stream,
    history: { current: () => null, push: () => {}, subscribe: () => () => {} },
  });
  assert.equal(await navigator.navigate("b"), false);
  assert.equal(field(f, "task"), "task-b");
  assert.equal(field(f, "label"), "Unknown");
  navigator.dispose();
});

test("same-identity refusal stays unknown and retries without duplicate history", async () => {
  const f = setup();
  const p = f.navigator.navigate("a");
  await tick();
  f.settle(0);
  await p;
  const previous = f.stream.state();
  f.navigator.dispose();
  let connects = 0,
    disconnects = 0,
    pushes = 0;
  const stream = {
    state: () => previous,
    connect: () => {
      connects++;
      return Promise.resolve(false);
    },
    disconnect: () => {
      disconnects++;
    },
    dispose: () => {},
  };
  const navigator = createTaskNavigator(f.root, {
    catalog: f.catalog,
    stream,
    history: {
      current: () => null,
      push: () => {
        pushes++;
      },
      subscribe: () => () => {},
    },
  });
  assert.equal(await navigator.navigate("a"), false);
  assert.equal(field(f, "task"), "task-a");
  assert.equal(field(f, "label"), "Unknown");
  assert.equal(await navigator.navigate("a"), false);
  assert.equal(connects, 2);
  assert.equal(pushes, 1);
  assert.ok(disconnects >= 2);
  navigator.dispose();
});

test("duplicate navigation while admission pending does not promise success", async () => {
  const f = setup();
  f.navigator.dispose();
  /** @type {(value:boolean)=>void} */ let resolve = () => {};
  const pending = new Promise((r) => {
    resolve = r;
  });
  let connects = 0,
    pushes = 0;
  const stream = {
    state: () => ({ status: "loading", identity: f.catalog[0].identity }),
    connect: () => {
      connects++;
      return pending;
    },
    disconnect: () => {},
    dispose: () => {},
  };
  const navigator = createTaskNavigator(f.root, {
    catalog: f.catalog,
    stream,
    history: {
      current: () => null,
      push: () => {
        pushes++;
      },
      subscribe: () => () => {},
    },
  });
  const first = navigator.navigate("a");
  assert.equal(
    f.root.querySelector('[aria-live="polite"]').textContent,
    "Status: loading",
  );
  assert.equal(field(f, "label"), "Unknown");
  assert.equal(await navigator.navigate("a"), false);
  assert.equal(connects, 1);
  assert.equal(pushes, 1);
  resolve(false);
  assert.equal(await first, false);
  assert.equal(field(f, "label"), "Unknown");
  navigator.dispose();
});
