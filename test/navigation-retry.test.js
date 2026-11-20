import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers";
import { readFile } from "node:fs/promises";
import { createTaskNavigator } from "../src/navigation.js";
import { createStreamProjection } from "../src/stream.js";
import { ElementDouble } from "./dom-double.js";
import {
  consoleScenarios,
  consoleTaskCatalog,
} from "../fixtures/console-ui/scenarios.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));

/** @param {typeof createTaskNavigator} [factory] @param {boolean} [failClose] */
function setup(factory = createTaskNavigator, failClose = false) {
  /** @type {any} */ const document = { activeElement: null };
  document.createElement = /** @param {string} tag */ (tag) =>
    new ElementDouble(tag, document);
  const root = document.createElement("main");
  /** @type {any[]} */ const subscriptions = [];
  /** @type {Array<{identity:any, resolve:(value:any)=>void}>} */ const reads =
    [];
  /** @type {string[]} */ const history = [];
  let closes = 0,
    views = 0,
    controls = 0;
  const adapters = {
    control: () => {
      controls++;
    },
  };
  const stream = createStreamProjection({
    clock: () => 1000,
    subscribe: (identity, callbacks) => {
      subscriptions.push({ identity, ...callbacks });
      return {
        close() {
          closes++;
          if (failClose) throw new Error("SECRET_CANARY");
        },
      };
    },
    readSnapshot: (identity) =>
      new Promise((resolve) => reads.push({ identity, resolve })),
    openPassive: () => {
      views++;
    },
    ...adapters,
  });
  const navigator = factory(root, {
    catalog: [...consoleTaskCatalog],
    stream,
    history: {
      current: () => null,
      push: (key) => history.push(key),
      subscribe: () => () => {},
    },
  });
  const button = root.querySelector("[data-retry-observation]");
  return {
    root,
    document,
    subscriptions,
    reads,
    history,
    stream,
    navigator,
    button,
    counts: () => ({ closes, views, controls }),
    /** @param {number} index @param {string} [label] */
    settle(index, label = "Observation") {
      reads[index].resolve({
        ...consoleScenarios.observation,
        identity: reads[index].identity,
        revision: consoleScenarios.observation.revision + index,
        label,
      });
    },
    field: /** @param {string} key */ (key) =>
      root.querySelector('[data-field="' + key + '"]').textContent,
    status: () => root.querySelector('[aria-live="polite"]').textContent,
  };
}

/** @param {ReturnType<typeof setup>} f */
async function connected(f) {
  const pending = f.navigator.navigate("a");
  await tick();
  f.settle(0, "Initial");
  assert.equal(await pending, true);
}

/** @param {typeof createTaskNavigator} factory @param {string} [event] */
async function recovered(factory, event = "onDisconnect") {
  const f = setup(factory);
  try {
    await connected(f);
    f.subscriptions[0][event]();
    f.navigator.update();
    assert.equal(
      f.status(),
      event === "onDisconnect" ? "Status: offline" : "Status: error",
    );
    const pending = f.navigator.retryObservation();
    await tick();
    assert.equal(
      f.subscriptions.length,
      2,
      "retry must acquire a fresh subscription",
    );
    assert.equal(f.status(), "Status: loading");
    assert.equal(f.field("task"), "task-a");
    assert.equal(f.field("label"), "Unknown");
    assert.deepEqual(f.history, ["a"]);
    f.settle(1, "Recovered");
    assert.equal(await pending, true);
    assert.equal(f.status(), "Status: ready");
    assert.equal(f.field("label"), "Recovered");
    assert.deepEqual(f.counts(), { closes: 1, views: 0, controls: 0 });
  } finally {
    f.navigator.dispose();
  }
}

test("explicit retry restores disconnected and failed observations without new history", async () => {
  await recovered(createTaskNavigator);
  await recovered(createTaskNavigator, "onError");
});

test("retry button suppresses repeated clicks during acquisition and keeps selection/focus", async () => {
  const f = setup();
  try {
    assert.equal(f.button.disabled, true);
    assert.equal(await f.navigator.retryObservation(), false);
    await connected(f);
    f.button.focus();
    f.button.click();
    f.button.click(); // The double intentionally does not enforce native disabled behavior.
    assert.equal(await f.navigator.retryObservation(), false);
    assert.equal(f.button.disabled, true);
    await tick();
    assert.equal(f.subscriptions.length, 2);
    assert.equal(f.reads.length, 2);
    assert.deepEqual(f.history, ["a"]);
    assert.equal(f.document.activeElement, f.button);
    f.settle(1);
    await tick();
    assert.equal(f.button.disabled, false);
    assert.equal(f.status(), "Status: ready");
    assert.equal(f.document.activeElement, f.button);
    assert.equal(f.counts().views, 0);
    assert.equal(f.counts().controls, 0);
  } finally {
    f.navigator.dispose();
  }
  f.button.click();
  assert.equal(await f.navigator.retryObservation(), false);
  assert.equal(f.subscriptions.length, 2);
});

test("task switching during retry fences old snapshot and late subscription events", async () => {
  const f = setup();
  try {
    await connected(f);
    const retry = f.navigator.retryObservation();
    await tick();
    const next = f.navigator.navigate("b");
    await tick();
    f.settle(2, "Task B");
    assert.equal(await next, true);
    f.settle(1, "Late task A");
    assert.equal(await retry, false);
    for (const subscription of f.subscriptions.slice(0, 2)) {
      subscription.onEvent({
        ...consoleScenarios.observation,
        identity: subscription.identity,
        revision: 99,
        label: "Old A",
      });
      subscription.onDisconnect();
      subscription.onError();
    }
    f.navigator.update();
    assert.equal(f.field("task"), "task-b");
    assert.equal(f.field("label"), "Task B");
    assert.equal(f.status(), "Status: ready");
    assert.deepEqual(f.history, ["a", "b"]);
    assert.equal(f.button.disabled, false);
    assert.equal(f.counts().views, 0);
    assert.equal(f.counts().controls, 0);
  } finally {
    f.navigator.dispose();
  }
});

test("unknown cleanup blocks explicit retries and never displays old observation as ready", async () => {
  const f = setup(createTaskNavigator, true);
  try {
    await connected(f);
    assert.equal(await f.navigator.retryObservation(), false);
    assert.equal(await f.navigator.retryObservation(), false);
    assert.equal(f.subscriptions.length, 1);
    assert.equal(f.reads.length, 1);
    assert.equal(f.stream.state().subscriptionCleanup, "unknown");
    assert.equal(f.field("task"), "task-a");
    assert.equal(f.field("label"), "Unknown");
    assert.equal(f.status(), "Status: unknown");
    assert.deepEqual(f.history, ["a"]);
    assert.deepEqual(f.counts(), { closes: 1, views: 0, controls: 0 });
    assert.ok(!f.root.textContent.includes("SECRET_CANARY"));
  } finally {
    f.navigator.dispose();
  }
});

test("disposal during retry prevents new work and late rendering", async () => {
  const f = setup();
  await connected(f);
  const retry = f.navigator.retryObservation();
  await tick();
  f.navigator.dispose();
  f.settle(1, "Late");
  assert.equal(await retry, false);
  assert.equal(f.root.children.length, 0);
  assert.equal(await f.navigator.retryObservation(), false);
  assert.equal(f.subscriptions.length, 2);
  assert.deepEqual(f.counts(), { closes: 2, views: 0, controls: 0 });
});

test("mutation removing forced retry is caught by independent subscription count", async () => {
  const source = await readFile(
    new URL("../src/navigation.js", import.meta.url),
    "utf8",
  );
  const before = "return select(selected, false, true);";
  assert.equal(source.split(before).length, 2);
  const mutated = source
    .replace(before, "return select(selected, false, false);")
    .replace(
      '"./view.js"',
      JSON.stringify(new URL("../src/view.js", import.meta.url).href),
    );
  const { createTaskNavigator: mutant } = await import(
    "data:text/javascript;base64," + Buffer.from(mutated).toString("base64")
  );
  await assert.rejects(
    recovered(mutant),
    /retry must acquire a fresh subscription/,
  );
});

test("disconnect or error during a pending snapshot permits explicit retry without waiting for old read", async () => {
  for (const event of ["onDisconnect", "onError"]) {
    const f = setup();
    try {
      const first = f.navigator.navigate("a");
      await tick();
      assert.equal(f.button.disabled, true);
      f.subscriptions[0][event]();
      f.navigator.update();
      assert.equal(f.button.disabled, false);
      assert.equal(
        f.status(),
        event === "onDisconnect" ? "Status: offline" : "Status: error",
      );
      const retry = f.navigator.retryObservation();
      await tick();
      assert.equal(f.subscriptions.length, 2);
      assert.equal(await f.navigator.retryObservation(), false);
      f.settle(1, "Replacement");
      assert.equal(await retry, true);
      f.settle(0, "Late original");
      assert.equal(await first, false);
      assert.equal(f.button.disabled, false);
      assert.equal(f.field("task"), "task-a");
      assert.equal(f.field("label"), "Replacement");
      assert.equal(f.status(), "Status: ready");
      assert.deepEqual(f.history, ["a"]);
      assert.equal(f.counts().views, 0);
      assert.equal(f.counts().controls, 0);
    } finally {
      f.navigator.dispose();
    }
  }
});
