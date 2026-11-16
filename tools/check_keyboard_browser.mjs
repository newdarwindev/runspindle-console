// Offline trusted-browser keyboard input. No browser installation or sandbox bypass.
/* global fetch, AbortSignal, WebSocket */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../", import.meta.url));
/** @param {number} ms */
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const browser = process.env.RUNSPINDLE_DOM_BROWSER || "chromium";
/** @typedef {{width: number, rootWidth: number, rootScroll: number, buttonWidth: number, buttonScroll: number, label: string, task: string, status: string, focus: string | null}} Layout */
/** @param {false | 'keyboard' | 'reflow'} mutation */
async function run(mutation) {
  const directory = await mkdtemp(join(tmpdir(), "console-keyboard-"));
  const longLabel = "L".repeat(256);
  /** @type {import('node:child_process').ChildProcess | undefined} */ let child;
  /** @type {WebSocket | undefined} */ let socket;
  let exited = false;
  /** @type {Map<number, {timer: ReturnType<typeof setTimeout>, resolve: (value: any) => void, reject: (reason: Error) => void}>} */
  const pending = new Map();
  let serial = 0;
  try {
    const names = [
      "src/projection.js",
      "src/view.js",
      "src/stream.js",
      "src/navigation.js",
      "fixtures/console-ui/scenarios.js",
    ];
    const sources = await Promise.all(
      names.map(async (name) => {
        let text = await readFile(join(root, name), "utf8");
        if (mutation && name === "src/navigation.js") {
          const needle =
            mutation === "keyboard"
              ? 'button.addEventListener("click", listener);'
              : 'button.style.overflowWrap = "anywhere";';
          assert.equal(text.split(needle).length, 2);
          text = text.replace(
            needle,
            mutation === "keyboard"
              ? 'button.addEventListener("never-click", listener);'
              : 'button.style.overflowWrap = "normal";',
          );
        }
        return text
          .replace(/^import \{[^\n]+\} from "\.\/[^"\n]+";\n/gm, "")
          .replaceAll("export ", "");
      }),
    );
    const script =
      sources.join("\n") +
      `
      globalThis.receipt = {subscriptions: 0, closes: 0, passive: 0, trusted: []};
      document.addEventListener('keydown', e => receipt.trusted.push(e.isTrusted));
      const stream = createStreamProjection({clock: () => 1000,
        subscribe: () => { receipt.subscriptions++; return {close: () => receipt.closes++}; },
        readSnapshot: identity => ({...consoleScenarios.observation, identity}),
        openPassive: () => { receipt.passive++; throw Error('forbidden'); }});
      globalThis.navigatorUnderTest = createTaskNavigator(document.querySelector('main'), {
        catalog: consoleTaskCatalog.map(task => task.key === 'a' ? {...task, label: ${JSON.stringify(longLabel)}} : task),
        stream, history: createBrowserTaskHistory(window)});
    `;
    const page = join(directory, "test.html");
    await writeFile(
      page,
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-keyboard'; connect-src 'none'; img-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><title>Synthetic offline keyboard qualification</title></head><body><main></main><script nonce="keyboard">${script.replaceAll("</script", "<\\/script")}</script></body></html>`,
    );
    child = spawn(
      browser,
      [
        "--headless",
        "--disable-gpu",
        "--no-first-run",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "--host-resolver-rules=MAP * ~NOTFOUND",
        "--disable-extensions",
        "--remote-debugging-port=0",
        "--remote-debugging-address=127.0.0.1",
        "--user-data-dir=" + join(directory, "profile"),
        "file://" + page,
      ],
      {
        stdio: "ignore",
        env: {
          ...process.env,
          HOME: directory,
          XDG_CONFIG_HOME: directory,
          XDG_CACHE_HOME: directory,
        },
      },
    );
    let startupError;
    child.on("error", (error) => {
      startupError = error;
      if (child?.pid === undefined) exited = true;
    });
    child.once("exit", () => {
      exited = true;
    });
    let port;
    for (let n = 0; n < 100; n++) {
      if (startupError || child.exitCode !== null)
        throw Error("browser_start_failed");
      try {
        port = Number(
          (
            await readFile(
              join(directory, "profile", "DevToolsActivePort"),
              "utf8",
            )
          ).split("\n")[0],
        );
        break;
      } catch {}
      await pause(50);
    }
    if (!port) throw Error("browser_start_timeout");
    /** @type {Array<{type: string, url: string, webSocketDebuggerUrl: string}>} */
    const targets = await (
      await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(2000),
      })
    ).json();
    const target = targets.find(
      (t) => t.type === "page" && t.url === "file://" + page,
    );
    assert.ok(target, "page target missing");
    const openedSocket = new WebSocket(target.webSocketDebuggerUrl);
    socket = openedSocket;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("cdp_open_timeout")), 2000);
      openedSocket.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve(undefined);
        },
        { once: true },
      );
      openedSocket.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(Error("cdp_open_failed"));
        },
        { once: true },
      );
    });
    openedSocket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const entry = pending.get(message.id);
      if (entry) {
        pending.delete(message.id);
        clearTimeout(entry.timer);
        message.error
          ? entry.reject(Error("cdp_error"))
          : entry.resolve(message.result);
      }
    });
    /** @param {string} method @param {Record<string, unknown>} [params] @returns {Promise<any>} */
    const command = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++serial;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(Error("cdp_command_timeout"));
        }, 2000);
        pending.set(id, { resolve, reject, timer });
        openedSocket.send(JSON.stringify({ id, method, params }));
      });
    /** @param {string} expression @returns {Promise<any>} */
    const evaluate = async (expression) => {
      const result = await command("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) throw Error("page_script_exception");
      return result.result.value;
    };
    for (
      let n = 0;
      n < 100 && !(await evaluate("!!globalThis.navigatorUnderTest"));
      n++
    )
      await pause(20);
    assert.ok(
      await evaluate("!!globalThis.navigatorUnderTest"),
      "page_not_ready",
    );
    await command("Page.bringToFront");
    /** @param {string} key @param {string} code @param {number} virtual @param {number} [modifiers] */
    const key = async (key, code, virtual, modifiers = 0) => {
      for (const type of ["keyDown", "keyUp"])
        await command("Input.dispatchKeyEvent", {
          type,
          key,
          code,
          windowsVirtualKeyCode: virtual,
          nativeVirtualKeyCode: virtual,
          modifiers,
          ...(type === "keyDown" && key === "Enter"
            ? { text: "\r" }
            : type === "keyDown" && key === " "
              ? { text: " " }
              : {}),
        });
    };
    const active = () =>
      evaluate(
        'document.activeElement?.getAttribute("data-task-key") || (document.activeElement?.hasAttribute("data-retry-observation") ? "retry" : null)',
      );
    const task = () =>
      evaluate('document.querySelector("[data-field=task]").textContent');
    /** @param {string} expected */
    const waitTask = async (expected) => {
      for (let n = 0; n < 50; n++) {
        if ((await task()) === expected) return;
        await pause(20);
      }
      throw Error("keyboard_activation_failed");
    };
    await key("Tab", "Tab", 9);
    assert.equal(await active(), "a", "first_tab_order");
    assert.ok(
      await evaluate('document.activeElement.matches(":focus-visible")'),
      "visible_keyboard_focus",
    );
    await key("Enter", "Enter", 13);
    await waitTask("task-a");
    await key("Tab", "Tab", 9);
    assert.equal(await active(), "b", "second_tab_order");
    await key(" ", "Space", 32);
    await waitTask("task-b");
    const before = await evaluate(
      "({count:receipt.subscriptions,length:history.length})",
    );
    await key(" ", "Space", 32);
    await pause(20);
    assert.deepEqual(
      await evaluate("({count:receipt.subscriptions,length:history.length})"),
      before,
      "duplicate_keyboard_selection",
    );
    await key("Tab", "Tab", 9);
    assert.equal(await active(), "retry", "retry_tab_order");
    await key("Tab", "Tab", 9, 8);
    assert.equal(await active(), "b", "reverse_tab_order");
    assert.ok(
      await evaluate(
        "receipt.trusted.length > 0 && receipt.trusted.every(Boolean)",
      ),
      "trusted_browser_input",
    );
    assert.equal(await evaluate("receipt.passive"), 0, "no_passive_effects");
    const zoomBefore = await evaluate(
      "({dpr:devicePixelRatio,width:innerWidth,scale:visualViewport.scale})",
    );
    for (let n = 0; n < 4; n++) await key("+", "Equal", 187, 2);
    await pause(100);
    const zoomAfter = await evaluate(
      "({dpr:devicePixelRatio,width:innerWidth,scale:visualViewport.scale})",
    );
    // Do not substitute CSS zoom, device emulation or pinch scaling for browser zoom.
    const zoom = {
      status: "blocked",
      reason: "browser_zoom_shortcut_not_qualified",
      before: zoomBefore,
      after: zoomAfter,
    };
    /** @type {Layout[]} */
    const layout = await evaluate(`(() => {
      const root=document.querySelector('main'); const button=root.querySelector('[data-task-key="a"]');
      return [320,390].map(width=>{
        root.style.width=width+'px';
        return {width,rootWidth:root.clientWidth,rootScroll:root.scrollWidth,
          buttonWidth:button.clientWidth,buttonScroll:button.scrollWidth,
          label:button.textContent,task:root.querySelector('[data-field="task"]').textContent,
          status:root.querySelector('[data-console-projection] [role="status"]').textContent,
          focus:document.activeElement?.getAttribute('data-task-key')};
      });
    })()`);
    if (
      !layout.every(
        (item) =>
          item.rootWidth === item.width &&
          item.rootScroll <= item.rootWidth + 1 &&
          item.buttonScroll <= item.buttonWidth + 1,
      )
    )
      throw Error("navigation_label_overflow");
    assert.ok(
      layout.every(
        (item) =>
          item.label === longLabel &&
          item.task === "task-b" &&
          item.status.startsWith("Status: ") &&
          item.focus === "b",
      ),
      "navigation_label_preserves_identity_status_focus",
    );
    await evaluate("navigatorUnderTest.dispose()");
    assert.ok(
      await evaluate(
        'receipt.closes === receipt.subscriptions && document.querySelector("main").children.length === 0',
      ),
      "disposal",
    );
    return {
      status: "passed",
      keyboard: "trusted Tab/Shift+Tab/Enter/Space",
      navigation_layout: layout.map(
        ({
          width,
          rootWidth,
          rootScroll,
          buttonWidth,
          buttonScroll,
          task,
          status,
          focus,
        }) => ({
          width,
          rootWidth,
          rootScroll,
          buttonWidth,
          buttonScroll,
          task,
          status,
          focus,
        }),
      ),
      zoom,
    };
  } finally {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(Error("cdp_closed"));
    }
    socket?.close();
    if (child && !exited) {
      child.kill("SIGTERM");
      for (let n = 0; n < 40 && !exited; n++) await pause(50);
      if (!exited) {
        child.kill("SIGKILL");
        for (let n = 0; n < 40 && !exited; n++) await pause(50);
      }
      if (!exited) throw Error("browser_cleanup_unknown");
    }
    await rm(directory, { recursive: true, force: true });
  }
}
let actual, mutant;
try {
  actual = await run(false);
} catch (error) {
  actual = {
    status: "failed",
    reason: error instanceof Error ? error.message : "unknown_error",
  };
}
try {
  mutant = await run("keyboard");
} catch (error) {
  mutant = {
    status: "failed",
    reason: error instanceof Error ? error.message : "unknown_error",
  };
}
let layoutMutant;
try {
  layoutMutant = await run("reflow");
} catch (error) {
  layoutMutant = {
    status: "failed",
    reason: error instanceof Error ? error.message : "unknown_error",
  };
}
const passed =
  actual.status === "passed" &&
  "reason" in mutant &&
  mutant.reason === "keyboard_activation_failed" &&
  "reason" in layoutMutant &&
  layoutMutant.reason === "navigation_label_overflow";
console.log(
  JSON.stringify({
    status: passed ? "passed" : "failed",
    actual,
    mutant,
    layoutMutant,
  }),
);
process.exitCode = passed ? 0 : 1;
