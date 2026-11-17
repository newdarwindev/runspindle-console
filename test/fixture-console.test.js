import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { createFakeConsoleServer } from "../fixtures/console-ui/fake-server.js";
import { consoleScenarios } from "../fixtures/console-ui/scenarios.js";
import { createFixtureConsole } from "../src/fixture-console.js";
import { ElementDouble } from "./dom-double.js";

const completeIdentity = Object.freeze({
  ...consoleScenarios.identity,
  nativeSession: "native-synthetic",
  span: "span-synthetic",
  artifactDigest: "sha256:" + "a".repeat(64),
});
function setup() {
  let time = 1000;
  /** @type {{activeElement:ElementDouble|null,createElement:(tag:string)=>ElementDouble}} */
  const document = {
    activeElement: null,
    createElement: (tag) => new ElementDouble(tag, document),
  };
  const root = document.createElement("main");
  const ui = createFixtureConsole(
    /** @type {HTMLElement} */ (/** @type {unknown} */ (root)),
    { clock: () => time },
  );
  const server = createFakeConsoleServer({
    clock: () => time,
    identity: completeIdentity,
    secrets: ["CANARY_SYNTHETIC_SECRET"],
  });
  return {
    root,
    ui,
    server,
    document,
    time: (value = 1000) => {
      time = value;
    },
  };
}
/** @param {ElementDouble} root @param {string} selector */
const node = (root, selector) => {
  const found = root.querySelector(selector);
  assert.ok(found);
  return found;
};

test("functional facet DOM preserves source time, identity, evidence and unsupported/unknown states", async () => {
  const f = setup();
  try {
    for (const name of f.server.facets)
      f.server.put(name, {
        id: name,
        label: "safe CANARY_SYNTHETIC_SECRET",
        secretCanary: "CANARY_SYNTHETIC_SECRET",
      });
    assert.equal(await f.ui.select(f.server), true);
    for (const name of f.server.facets) {
      assert.equal(
        node(f.root, `[data-facet-status="${name}"]`).textContent,
        "ready",
      );
      assert.match(
        node(f.root, `[data-facet-items="${name}"]`).textContent,
        /native-synthetic/,
      );
    }
    assert.doesNotMatch(f.root.textContent, /CANARY_SYNTHETIC_SECRET/);
    assert.match(f.root.textContent, /SIMULATED/);
    f.time(2000);
    await f.ui.refresh();
    assert.equal(
      node(f.root, '[data-facet-status="tasks"]').textContent,
      "stale",
    );
    assert.equal(
      node(f.root, '[data-facet-observed="tasks"]').textContent,
      "Observed: 1000",
    );
    for (const status of consoleScenarios.statuses) {
      f.server.setFacet("tasks", status, 2000);
      await f.ui.refresh();
      assert.equal(
        node(f.root, '[data-facet-status="tasks"]').textContent,
        status,
      );
    }
    f.server.setFacet("tasks", "ready", null);
    await f.ui.refresh();
    assert.equal(
      node(f.root, '[data-facet-status="tasks"]').textContent,
      "unknown",
    );
    f.server.setFacet("tasks", "ready", 3000);
    await f.ui.refresh();
    assert.equal(
      node(f.root, '[data-facet-status="tasks"]').textContent,
      "unknown",
    );
    f.server.fail("traces");
    await f.ui.refresh();
    assert.equal(
      node(f.root, '[data-facet-status="traces"]').textContent,
      "error",
    );
    assert.notEqual(
      node(f.root, '[data-facet-status="artifacts"]').textContent,
      "error",
    );
  } finally {
    f.ui.dispose();
    f.server.dispose();
  }
});

test("synthetic authoritative buttons cannot be forged into permission or duplicate requests", async () => {
  const f = setup();
  try {
    await f.ui.select(f.server);
    const done = f.server.deferNext("control");
    const first = f.ui.control("takeover");
    assert.equal(await f.ui.control("takeover"), false);
    assert.equal(f.server.calls.length, 1);
    done();
    assert.equal(await first, true);
    assert.equal(f.ui.state().authority, "pending");
    f.server.decide("denied");
    await f.ui.refresh();
    assert.equal(f.ui.state().authority, "denied");
    f.server.decide("human");
    await f.ui.refresh();
    assert.equal(
      node(f.root, '[data-fixture-action="release"]').disabled,
      false,
    );
    assert.equal(await f.ui.control("release"), true);
    assert.equal(f.ui.state().authority, "handback_pending");
    f.server.decide("unknown");
    await f.ui.refresh();
    const button = node(f.root, '[data-fixture-action="takeover"]');
    button.disabled = false;
    button.click();
    await setImmediate();
    assert.equal(f.server.calls.length, 2);
    assert.equal(f.ui.state().canExecute, false);
    await assert.rejects(
      f.server.control({
        identity: { ...completeIdentity, leaseEpoch: 0 },
        action: "takeover",
        requestId: "stale",
      }),
    );
    await assert.rejects(
      f.server.control({
        identity: { ...completeIdentity, task: "other" },
        action: "takeover",
        requestId: "wrong",
      }),
    );
    f.server.decide("denied");
    await f.ui.refresh();
    f.time(1040);
    assert.equal(await f.ui.control("takeover"), false);
    assert.equal(f.server.calls.length, 2);
  } finally {
    f.ui.dispose();
    f.server.dispose();
  }
});

test("passive frame emits zero control and failed closure fences handback across selection", async () => {
  const f = setup();
  const second = createFakeConsoleServer({
    clock: () => 1000,
    identity: { ...completeIdentity, task: "other" },
  });
  try {
    await f.ui.select(f.server);
    assert.equal(await f.ui.openView(), true);
    assert.match(node(f.root, "[data-fixture-frame]").textContent, /SIMULATED/);
    assert.equal(f.server.passiveCalls.length, 1);
    assert.equal(f.server.calls.length, 0);
    assert.equal(await f.ui.openView(), false);
    f.server.setViewer("simulated", true);
    f.server.decide("human");
    await f.ui.refresh();
    assert.equal(await f.ui.closeView(), false);
    assert.equal(await f.ui.control("release"), false);
    assert.equal(f.server.resources.viewers, 1);
    await f.ui.select(second);
    assert.equal(await f.ui.openView(), false);
    assert.equal(second.passiveCalls.length, 0);
    assert.equal(f.ui.state().canExecute, false);
  } finally {
    f.ui.dispose();
    f.server.setViewer("simulated", false);
    f.server.dispose();
    second.dispose();
  }
});

test("late facet and control responses cannot populate another selected target", async () => {
  const f = setup();
  const second = createFakeConsoleServer({
    clock: () => 1000,
    identity: {
      ...completeIdentity,
      task: "task-b",
      nativeSession: "native-b",
    },
  });
  try {
    await f.ui.select(f.server);
    f.server.put("tasks", { id: "old-task" });
    second.put("tasks", { id: "new-task" });
    const releaseRead = f.server.deferNext("tasks"),
      read = f.ui.refresh();
    const releaseControl = f.server.deferNext("control"),
      control = f.ui.control("takeover");
    assert.equal(await f.ui.select(second), true);
    releaseRead();
    releaseControl();
    assert.equal(await read, false);
    assert.equal(await control, false);
    assert.match(f.root.textContent, /new-task/);
    assert.doesNotMatch(f.root.textContent, /old-task/);
    assert.equal(f.ui.state().identity?.nativeSession, "native-b");
    assert.equal(f.ui.state().authority, "denied");
    assert.equal(second.calls.length, 0);
  } finally {
    f.ui.dispose();
    f.server.dispose();
    second.dispose();
  }
});

test("older overlapping facet reads never replace newer revision", async () => {
  const f = setup();
  try {
    await f.ui.select(f.server);
    f.server.put("tasks", { id: "old" });
    const release = f.server.deferNext("tasks");
    const old = f.ui.refresh();
    release();
    f.server.put("tasks", { id: "new" });
    const latest = f.ui.refresh();
    await Promise.all([old, latest]);
    assert.match(node(f.root, '[data-facet-items="tasks"]').textContent, /new/);
  } finally {
    f.ui.dispose();
    f.server.dispose();
  }
});

test("server snapshots/ledgers are immutable and target-bound; forged reply cannot grant", async () => {
  const f = setup();
  try {
    f.server.put("tasks", {
      id: "item",
      nested: { secret: "CANARY_SYNTHETIC_SECRET" },
    });
    const result = await f.server.read("tasks");
    assert.equal(Object.isFrozen(result.items[0].identity), true);
    assert.throws(() => {
      result.items[0].identity = "forged";
    });
    assert.equal(Object.hasOwn(result.items[0], "nested"), false);
    await assert.rejects(
      f.server.readSnapshot({ ...completeIdentity, nativeSession: "other" }),
    );
    assert.throws(() =>
      f.server.subscribe(
        { ...completeIdentity, host: "wrong" },
        { onEvent: () => {}, onDisconnect: () => {} },
      ),
    );
    const forged = {
      ...f.server,
      control: async () => ({
        ...f.server.authority(),
        state: "human",
        canRelease: true,
      }),
    };
    await f.ui.select(forged);
    await f.ui.control("takeover");
    assert.equal(f.ui.state().authority, "denied");
    assert.equal(
      node(f.root, '[data-fixture-action="release"]').disabled,
      true,
    );
    const request = {
      identity: completeIdentity,
      action: "takeover",
      requestId: "same",
    };
    await f.server.control(request);
    await f.server.control(request);
    assert.equal(f.server.calls.length, 1);
    await assert.rejects(f.server.control({ ...request, action: "release" }));
    assert.throws(() => f.server.calls.push({}));
  } finally {
    f.ui.dispose();
    f.server.dispose();
  }
});

test("viewer unavailable unauthorized disconnected and unmount delayed acquisition remain passive", async () => {
  for (const viewer of ["unavailable", "unauthorized", "disconnected"]) {
    const f = setup();
    try {
      await f.ui.select(f.server);
      f.server.setViewer(viewer);
      assert.equal(await f.ui.openView(), false);
      assert.equal(f.server.calls.length, 0);
      assert.equal(f.server.passiveCalls.length, 0);
    } finally {
      f.ui.dispose();
      f.server.dispose();
    }
  }
  const f = setup();
  try {
    await f.ui.select(f.server);
    const release = f.server.deferNext("passive"),
      opening = f.ui.openView();
    f.ui.dispose();
    release();
    assert.equal(await opening, false);
    assert.equal(f.server.resources.viewers, 0);
    assert.equal(f.server.calls.length, 0);
    assert.equal(f.root.children.length, 0);
  } finally {
    f.server.dispose();
  }
});

test("remount gets new server-scoped request identity and distinct real fake effect", async () => {
  const f = setup();
  let replacement;
  try {
    await f.ui.select(f.server);
    await f.ui.control("takeover");
    assert.equal(f.server.calls.length, 1);
    f.ui.dispose();
    f.server.decide("denied");
    replacement = createFixtureConsole(
      /** @type {HTMLElement} */ (/** @type {unknown} */ (f.root)),
      { clock: () => 1000 },
    );
    await replacement.select(f.server);
    assert.equal(await replacement.control("takeover"), true);
    assert.equal(f.server.calls.length, 2);
    assert.notEqual(f.server.calls[0].requestId, f.server.calls[1].requestId);
    assert.equal(f.server.authority().state, "pending");
  } finally {
    replacement?.dispose();
    f.ui.dispose();
    f.server.dispose();
  }
});

test(
  "abort settles delayed read/passive/control without releasing held backend response",
  { timeout: 2000 },
  async () => {
    const server = createFakeConsoleServer({ clock: () => 1000 });
    try {
      for (const kind of ["tasks", "passive", "control"]) {
        server.deferNext(kind);
        const abort = new globalThis.AbortController();
        const promise =
          kind === "tasks"
            ? server.read("tasks", { signal: abort.signal })
            : kind === "passive"
              ? server.openPassive(
                  {
                    identity: server.identity,
                    mode: "passive",
                    simulated: true,
                    url: "https://viewer.invalid/passive",
                  },
                  { signal: abort.signal },
                )
              : server.control(
                  {
                    identity: server.identity,
                    action: "takeover",
                    requestId: server.allocateRequestId(),
                  },
                  { signal: abort.signal },
                );
        abort.abort();
        await assert.rejects(promise, /aborted/);
        assert.equal(server.resources.delays, 0);
        assert.equal(server.resources.viewers, 0);
      }
    } finally {
      server.dispose();
    }
  },
);

test("malformed or foreign facet envelope/items never render under selected identity", async () => {
  const f = setup();
  try {
    f.server.put("tasks", { id: "safe" });
    const genuine = await f.server.read("tasks");
    const variants = [
      { ...genuine, identity: { ...genuine.identity, task: "foreign" } },
      {
        ...genuine,
        items: [
          {
            ...genuine.items[0],
            identity: { ...completeIdentity, nativeSession: "foreign-session" },
            label: "foreign-canary",
          },
        ],
      },
      { ...genuine, status: "invented-status" },
      { ...genuine, evidenceClass: "live_acceptance" },
      {
        ...genuine,
        items: [{ ...genuine.items[0], secret: "foreign-canary" }],
      },
    ];
    for (const bad of variants) {
      /** @type {typeof f.server} */
      const server = {
        ...f.server,
        read: async (name, options) =>
          name === "tasks" ? bad : f.server.read(name, options),
      };
      await f.ui.select(server);
      assert.equal(
        node(f.root, '[data-facet-status="tasks"]').textContent,
        "unknown",
      );
      assert.equal(node(f.root, '[data-facet-items="tasks"]').textContent, "");
      assert.doesNotMatch(
        f.root.textContent,
        /foreign-canary|foreign-session|live_acceptance/,
      );
    }
  } finally {
    f.ui.dispose();
    f.server.dispose();
  }
});

test("older fresh authority cannot preserve expired newer cached grant", async () => {
  const f = setup();
  try {
    f.server.decide("human");
    let observation = f.server.authority();
    const selected = { ...f.server, authority: () => observation };
    await f.ui.select(selected);
    assert.equal(
      node(f.root, '[data-fixture-action="release"]').disabled,
      false,
    );
    f.time(1040);
    observation = {
      ...observation,
      state: "denied",
      revision: 1,
      observedAt: 1040,
      canTakeover: true,
      canRelease: false,
    };
    await f.ui.refresh();
    assert.equal(f.ui.state().authority, "unknown");
    assert.equal(
      node(f.root, '[data-fixture-action="release"]').disabled,
      true,
    );
    assert.equal(await f.ui.control("release"), false);
    assert.equal(f.server.calls.length, 0);
  } finally {
    f.ui.dispose();
    f.server.dispose();
  }
});

test("simultaneous mounts have distinct described-by targets", () => {
  const a = setup(),
    b = setup();
  try {
    const first = node(a.root, '[data-fixture-action="takeover"]').getAttribute(
        "aria-describedby",
      ),
      second = node(b.root, '[data-fixture-action="takeover"]').getAttribute(
        "aria-describedby",
      );
    assert.ok(first);
    assert.ok(second);
    assert.notEqual(first, second);
  } finally {
    a.ui.dispose();
    b.ui.dispose();
    a.server.dispose();
    b.server.dispose();
  }
});

test(
  "old same-name release cannot erase a queued successor delay",
  { timeout: 2000 },
  async () => {
    const server = createFakeConsoleServer({ clock: () => 1000 });
    try {
      const releaseFirst = server.deferNext("tasks");
      const first = server.read("tasks");
      const releaseSecond = server.deferNext("tasks");
      releaseFirst();
      await first;
      let finished = false;
      const second = server.read("tasks").then((value) => {
        finished = true;
        return value;
      });
      await setImmediate();
      assert.equal(finished, false);
      assert.equal(server.resources.delays, 1);
      releaseSecond();
      await second;
      assert.equal(server.resources.delays, 0);
    } finally {
      server.dispose();
    }
  },
);

test(
  "late release after abort cannot erase another same-name delay",
  { timeout: 2000 },
  async () => {
    const server = createFakeConsoleServer({ clock: () => 1000 });
    try {
      const abort = new globalThis.AbortController();
      const releaseFirst = server.deferNext("tasks");
      const first = server.read("tasks", { signal: abort.signal });
      abort.abort();
      await assert.rejects(first, /aborted/);
      const releaseSecond = server.deferNext("tasks");
      releaseFirst();
      let finished = false;
      const second = server.read("tasks").then((value) => {
        finished = true;
        return value;
      });
      await setImmediate();
      assert.equal(finished, false);
      assert.equal(server.resources.delays, 1);
      releaseSecond();
      await second;
      assert.equal(server.resources.delays, 0);
    } finally {
      server.dispose();
    }
  },
);
