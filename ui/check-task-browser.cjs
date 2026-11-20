/* global require, document, history, getComputedStyle, visualViewport, outerWidth, innerWidth, innerHeight, devicePixelRatio */
const assert = require("node:assert/strict");
const {
  cp,
  mkdtemp,
  mkdir,
  appendFile,
  readFile,
  rm,
  writeFile,
} = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const {
  validateFocusOutline,
  validatePair,
  zoomPreferences,
} = require("../tools/check_console_visuals.cjs");

const [distribution, browser] = process.argv.slice(2);
assert(distribution && browser, "provide built distribution and Chrome binary");

/** @param {import("playwright").Locator} button */
async function checkFocus(button) {
  const focus = await button.evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      visible: element.matches(":focus-visible"),
      unobscured:
        document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        ) === element,
      rect: rect.toJSON(),
      bounds: { top: 0, left: 0, right: innerWidth, bottom: innerHeight },
      outline: style.outlineStyle,
      width: parseFloat(style.outlineWidth),
      offset: parseFloat(style.outlineOffset),
    };
  });
  assert(focus.visible && focus.unobscured, "task button focus is obscured");
  validateFocusOutline(focus);
}

/** @param {"a" | "b"} key */
function expectedObservation(key) {
  const fresh = key === "a";
  return {
    task: `task-${key}`,
    host: `host-synthetic-${key}`,
    workspace: `workspace-synthetic-${key}`,
    nativeSession: `session-synthetic-${key}`,
    browser: `browser-synthetic-${key}`,
    leaseEpoch: fresh ? "1" : "2",
    trace: `trace-synthetic-${key}`,
    span: `span-synthetic-${key}`,
    artifactDigest: "sha256:" + key.repeat(64),
    observedAt: fresh ? "2001" : "1000",
    revision: "1",
    freshness: fresh ? "fresh" : "stale",
    acceptance: "Unknown — not supplied by this projection",
    delivery: "Unknown — not supplied by this projection",
  };
}

/** @param {string} directory @param {number | null} width @param {number} zoom */
async function check(directory, width, zoom) {
  const profile = await mkdtemp(join(tmpdir(), "console-task-chrome-"));
  const preferences = join(profile, "Default");
  /** @type {import("playwright").BrowserContext | undefined} */
  let context;
  try {
    await mkdir(preferences);
    await writeFile(
      join(preferences, "Preferences"),
      JSON.stringify(zoomPreferences(zoom)),
    );
    context = await chromium.launchPersistentContext(profile, {
      executablePath: resolve(browser),
      chromiumSandbox: true,
      headless: true,
      offline: true,
      locale: "en-US",
      timezoneId: "UTC",
      viewport: width === null ? null : { width, height: 844 },
      args: ["--window-size=1440,900", "--disable-background-networking"],
      timeout: 15000,
    });
    context.setDefaultTimeout(5000);
    /** @type {string[]} */
    const unexpected = [];
    await context.route("**/*", (route) => {
      if (route.request().url().startsWith("file:")) return route.continue();
      unexpected.push(route.request().url());
      return route.abort();
    });
    const page = context.pages()[0];
    page.on("pageerror", (error) => unexpected.push(error.message));
    const session = await context.newCDPSession(page);
    const commandLine = await session.send("Browser.getBrowserCommandLine");
    assert(
      !commandLine.arguments.some((arg) =>
        ["--no-sandbox", "--disable-setuid-sandbox"].includes(arg),
      ),
    );
    await page.goto(pathToFileURL(resolve(directory, "index.html")).href);
    await page.getByRole("link", { name: "Browse synthetic tasks" }).click();
    assert(new URL(page.url()).pathname.endsWith("/tasks.html"));
    const nav = page.getByRole("navigation", { name: "Tasks" });
    const a = nav.getByRole("button", { name: "Synthetic task a" });
    const b = nav.getByRole("button", { name: "Synthetic task b" });
    const projection = page.getByRole("region", {
      name: "Read-only task projection",
    });
    const label = projection.locator('[data-field="label"]');
    /** @param {Record<string, string>} expected */
    const checkFields = async (expected) => {
      for (const [field, value] of Object.entries(expected))
        assert.equal(
          await projection.locator(`[data-field="${field}"]`).textContent(),
          value,
          `incorrect task projection field: ${field}`,
        );
    };
    /** @param {string} task @param {string} status */
    const waitForProjection = (task, status) =>
      page.waitForFunction(
        ([expectedTask, expectedStatus]) =>
          document.querySelector('[data-field="task"]')?.textContent ===
            expectedTask &&
          document.querySelector("[data-console-projection] [role=status]")
            ?.textContent === expectedStatus,
        [task, "Status: " + status],
      );
    /** @param {"a" | "b"} key */
    const show = async (key) => {
      await waitForProjection(`task-${key}`, key === "a" ? "ready" : "stale");
      await checkFields(expectedObservation(key));
    };

    await show("a");
    assert.equal(await a.getAttribute("aria-current"), "page");
    const historyLength = await page.evaluate(() => history.length);
    await page.getByRole("link", { name: "Observation scenarios" }).focus();
    await page.keyboard.press("Tab");
    await checkFocus(a);
    await page.keyboard.press("Tab");
    await checkFocus(b);
    await page.keyboard.press("Shift+Tab");
    await checkFocus(a);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Space");
    await show("b");
    assert.equal(await b.getAttribute("aria-current"), "page");
    assert.equal(await page.evaluate(() => history.length), historyLength + 1);
    await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(() => history.length), historyLength + 1);
    assert.match(await label.innerText(), /synthetic-synthetic-/);
    assert.match(await label.innerText(), /<img src=.*<script>/);
    assert.equal(await projection.locator("img, script, iframe, a").count(), 0);
    assert.equal(await projection.getByRole("button").count(), 0);
    assert(
      await projection
        .locator("[data-field]")
        .evaluateAll(
          (fields) =>
            document.documentElement.scrollWidth <= innerWidth + 1 &&
            fields.every(
              (element) => element.scrollWidth <= element.clientWidth + 1,
            ),
        ),
      "task observation clipped horizontally",
    );
    await page.evaluate(() => history.back());
    await show("a");
    assert(await a.evaluate((element) => document.activeElement === element));
    await page.evaluate(() => history.forward());
    await show("b");
    assert(await b.evaluate((element) => document.activeElement === element));

    await page.evaluate(() => {
      history.pushState({ runspindleConsoleTask: "unknown-task" }, "");
      history.back();
    });
    await page.waitForFunction(
      () => history.state?.runspindleConsoleTask === "b",
    );
    await page.evaluate(() => history.forward());
    await waitForProjection("Unknown", "unknown");
    assert.equal(await nav.locator('[aria-current="page"]').count(), 0);
    const unknownFields = Object.fromEntries(
      Object.keys(expectedObservation("a")).map((field) => [field, "Unknown"]),
    );
    await checkFields({
      ...unknownFields,
      label: "Unknown",
      freshness: "unknown",
      acceptance: expectedObservation("a").acceptance,
      delivery: expectedObservation("a").delivery,
    });
    assert.deepEqual(unexpected, []);
    return await page.evaluate(() => ({
      cssZoom: getComputedStyle(document.documentElement).zoom,
      visualViewportScale: visualViewport?.scale ?? 1,
      outerWidth,
      dpr: devicePixelRatio,
      innerWidth,
    }));
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
}

(async () => {
  const normal = await check(distribution, null, 100);
  const zoomed = await check(distribution, null, 200);
  validatePair(normal, zoomed);
  const tablet = await check(distribution, 768, 100);
  const mobile = await check(distribution, 390, 100);
  const narrowMobile = await check(distribution, 320, 100);
  assert.equal(normal.innerWidth, 1440);
  assert.equal(tablet.innerWidth, 768);
  assert.equal(mobile.innerWidth, 390);
  assert.equal(narrowMobile.innerWidth, 320);
  const mutation = await mkdtemp(join(tmpdir(), "console-task-mutations-"));
  try {
    const clipped = join(mutation, "clipped");
    const substituted = join(mutation, "substituted-host");
    await cp(distribution, clipped, { recursive: true });
    await appendFile(
      join(clipped, "style.css"),
      '\n#tasks [data-field="label"] { white-space: nowrap; }\n',
    );
    await assert.rejects(check(clipped, 390, 100), {
      message: "task observation clipped horizontally",
    });
    await cp(distribution, substituted, { recursive: true });
    const script = join(substituted, "tasks.js");
    const source = await readFile(script, "utf8");
    const host = "host: `host-synthetic-${key}`";
    assert.equal(
      source.split(host).length,
      2,
      "missing single host mutation target",
    );
    await writeFile(script, source.replace(host, 'host: "host-synthetic-a"'));
    await assert.rejects(check(substituted, 320, 100), {
      message: /^incorrect task projection field: host/,
    });
  } finally {
    await rm(mutation, { recursive: true, force: true });
  }
  console.log(
    JSON.stringify({
      normal,
      zoomed,
      tablet,
      mobile,
      narrowMobile,
      clippingMutation: "detected",
      staleHostMutation: "detected",
    }),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
