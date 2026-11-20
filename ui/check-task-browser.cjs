/* global require, document, history, getComputedStyle, visualViewport, outerWidth, innerWidth, devicePixelRatio */
const assert = require("node:assert/strict");
const {
  cp,
  mkdtemp,
  mkdir,
  appendFile,
  rm,
  writeFile,
} = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const {
  validatePair,
  zoomPreferences,
} = require("../tools/check_console_visuals.cjs");

const [distribution, browser] = process.argv.slice(2);
assert(distribution && browser, "provide built distribution and Chrome binary");

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
      viewport: width === null ? null : { width, height: 844 },
      args: ["--window-size=1280,900", "--disable-background-networking"],
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
    /** @param {string} task @param {string} status */
    const show = async (task, status) =>
      page.waitForFunction(
        ([expectedTask, expectedStatus]) =>
          document.querySelector('[data-field="task"]')?.textContent ===
            expectedTask &&
          document.querySelector("[data-console-projection] [role=status]")
            ?.textContent === expectedStatus,
        [task, "Status: " + status],
      );

    await show("task-a", "ready");
    assert.equal(await a.getAttribute("aria-current"), "page");
    const historyLength = await page.evaluate(() => history.length);
    await page.getByRole("link", { name: "Observation scenarios" }).focus();
    await page.keyboard.press("Tab");
    assert(await a.evaluate((element) => element.matches(":focus-visible")));
    await page.keyboard.press("Tab");
    assert(await b.evaluate((element) => element.matches(":focus-visible")));
    await page.keyboard.press("Space");
    await show("task-b", "ready");
    assert.equal(await b.getAttribute("aria-current"), "page");
    assert.equal(await page.evaluate(() => history.length), historyLength + 1);
    await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(() => history.length), historyLength + 1);
    assert.match(await label.innerText(), /synthetic-synthetic-/);
    assert.match(await label.innerText(), /<img src=.*<script>/);
    assert.equal(await projection.locator("img, script, iframe, a").count(), 0);
    assert(
      await label.evaluate(
        (element) =>
          element.scrollWidth <= element.clientWidth + 1 &&
          document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "task observation clipped horizontally",
    );
    await page.evaluate(() => history.back());
    await show("task-a", "ready");
    assert(await a.evaluate((element) => document.activeElement === element));
    await page.evaluate(() => history.forward());
    await show("task-b", "ready");
    assert(await b.evaluate((element) => document.activeElement === element));

    await page.evaluate(() => {
      history.pushState({ runspindleConsoleTask: "unknown-task" }, "");
      history.back();
    });
    await page.waitForFunction(
      () => history.state?.runspindleConsoleTask === "b",
    );
    await page.evaluate(() => history.forward());
    await show("Unknown", "unknown");
    assert.equal(await nav.locator('[aria-current="page"]').count(), 0);
    assert.equal(await label.innerText(), "Unknown");
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
  assert.equal(tablet.innerWidth, 768);
  assert.equal(mobile.innerWidth, 390);
  const mutation = await mkdtemp(join(tmpdir(), "console-task-clipping-"));
  try {
    await cp(distribution, mutation, { recursive: true });
    await appendFile(
      join(mutation, "style.css"),
      '\n#tasks [data-field="label"] { white-space: nowrap; }\n',
    );
    await assert.rejects(check(mutation, 390, 100), {
      message: "task observation clipped horizontally",
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
      clippingMutation: "detected",
    }),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
