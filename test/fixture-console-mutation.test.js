import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createFakeConsoleServer } from "../fixtures/console-ui/fake-server.js";
import { consoleScenarios } from "../fixtures/console-ui/scenarios.js";
import { createFixtureConsole } from "../src/fixture-console.js";
import { ElementDouble } from "./dom-double.js";

/** @param {string} relative @param {string} needle @param {string} replacement @param {(url:string)=>Promise<void>} exercise */
async function mutated(relative, needle, replacement, exercise) {
  const directory = await mkdtemp(
    join(tmpdir(), "console-functional-mutation-"),
  );
  try {
    const original = new URL(relative, import.meta.url);
    let text = await readFile(original, "utf8");
    assert.equal(text.split(needle).length, 2);
    text = text
      .replace(needle, replacement)
      .replace(
        /from "([.][^"\n]+)"/g,
        (_all, dependency) => `from "${new URL(dependency, original).href}"`,
      );
    const file = join(directory, "mutant.mjs");
    await writeFile(file, text);
    await exercise(pathToFileURL(file).href);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
function rootDouble() {
  /** @type {{activeElement:ElementDouble|null,createElement:(tag:string)=>ElementDouble}} */ const document =
    {
      activeElement: null,
      createElement: (tag) => new ElementDouble(tag, document),
    };
  return /** @type {HTMLElement} */ (
    /** @type {unknown} */ (document.createElement("main"))
  );
}

test("authoritative target-fence source mutation admits an independently observed wrong-target request", async () => {
  const request = {
    identity: { ...consoleScenarios.identity, task: "wrong-target" },
    action: "takeover",
    requestId: "wrong-target",
  };
  const original = createFakeConsoleServer({ clock: () => 1000 });
  try {
    await assert.rejects(original.control(request));
    assert.equal(original.calls.length, 0);
  } finally {
    original.dispose();
  }
  await mutated(
    "../fixtures/console-ui/fake-server.js",
    "if (!fixtureIdentityMatches(target, bound))",
    "if (false)",
    async (url) => {
      const module = await import(url);
      const server = module.createFakeConsoleServer({ clock: () => 1000 });
      try {
        await server.control(request);
        assert.equal(server.calls.length, 1);
        assert.equal(server.calls[0].identity.task, "wrong-target");
        assert.equal(server.authority().state, "pending");
      } finally {
        server.dispose();
      }
    },
  );
});

test("UI admission source mutation exposes forbidden request while backend still cannot execute", async () => {
  const original = createFakeConsoleServer({ clock: () => 1000 });
  original.decide("unknown");
  const ui = createFixtureConsole(rootDouble(), { clock: () => 1000 });
  try {
    await ui.select(original);
    assert.equal(await ui.control("takeover"), false);
    assert.equal(original.calls.length, 0);
  } finally {
    ui.dispose();
    original.dispose();
  }
  await mutated(
    "../src/fixture-console.js",
    '!(action === "takeover" ? authority?.canTakeover : authority?.canRelease)',
    "false",
    async (url) => {
      const module = await import(url);
      const server = createFakeConsoleServer({ clock: () => 1000 });
      server.decide("unknown");
      const mutatedUI = module.createFixtureConsole(rootDouble(), {
        clock: () => 1000,
      });
      try {
        await mutatedUI.select(server);
        await mutatedUI.control("takeover");
        assert.equal(server.calls.length, 1);
        assert.equal(server.authority().state, "unknown");
        assert.equal(server.authority().canExecute, false);
      } finally {
        mutatedUI.dispose();
        server.dispose();
      }
    },
  );
});

test("component uses no network fallback or real control effect", async (context) => {
  let fetches = 0;
  context.mock.method(globalThis, "fetch", () => {
    fetches++;
    throw Error("outbound network forbidden");
  });
  const server = createFakeConsoleServer({ clock: () => 1000 });
  const ui = createFixtureConsole(rootDouble(), { clock: () => 1000 });
  try {
    await ui.select(server);
    await ui.openView();
    await ui.closeView();
    await ui.refresh();
    assert.equal(fetches, 0);
    assert.equal(server.calls.length, 0);
    assert.equal(ui.state().canExecute, false);
  } finally {
    ui.dispose();
    server.dispose();
  }
});
