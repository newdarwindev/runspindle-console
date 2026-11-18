/* global require, __dirname, __filename, document, getComputedStyle, visualViewport, outerWidth, innerWidth, devicePixelRatio */
// Bounded synthetic browser check. Captures are candidates, never self-approved baselines.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const {
  nativeBitmap,
  zoomPreferences,
  validatePair,
} = require("../tools/check_console_visuals.cjs");
const [built, output, playwright, browser, baseline] = process.argv.slice(2);
assert(built && output && playwright && browser);
assert(!fs.existsSync(output), "fresh evidence directory required");
fs.mkdirSync(output, { recursive: true });
/** @type {typeof import("playwright")} */
const { chromium } = require(path.resolve(playwright));
/** @param {string} p */
const sha = (p) =>
  crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
/** @type {{schema:string,evidence:string,baseline_review:string,live_backend:boolean,cases:object[],browser_sha256:string,package_lock_sha256:string,status?:string,baseline_comparison?:string,error?:string}} */
const receipt = {
  schema: "console.react-radix.visual.v1",
  evidence: "synthetic-browser-only",
  baseline_review: "pending-independent-review",
  live_backend: false,
  cases: [],
  browser_sha256: sha(browser),
  package_lock_sha256: sha(path.join(__dirname, "package-lock.json")),
};
fs.writeFileSync(
  path.join(output, "source-binding.json"),
  JSON.stringify(
    {
      lock: sha(path.join(__dirname, "package-lock.json")),
      bundle: sha(path.join(built, "app.js")),
      html: sha(path.join(built, "index.html")),
      css: sha(path.join(built, "style.css")),
      harness: sha(__filename),
      playwright: require(path.join(path.resolve(playwright), "package.json"))
        .version,
    },
    null,
    2,
  ),
);
const states = [
  "fresh",
  "loading",
  "stale",
  "offline",
  "effect-unknown",
  "approval-required",
  "takeover-pending",
  "error",
];
/** @type {import("playwright").BrowserContext | null | undefined} */
let context;
(async () => {
  for (const width of [1440, 500, 390]) {
    const mobile = width === 390;
    /** @type {Record<number, import("../tools/console-visual-browser-types").Metrics>} */
    const metrics = {};
    for (const zoom of mobile ? [100] : [100, 200]) {
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), "console-reuse-"));
      fs.mkdirSync(path.join(profile, "Default"));
      fs.writeFileSync(
        path.join(profile, "Default/Preferences"),
        JSON.stringify(zoomPreferences(zoom)),
      );
      try {
        context = await chromium.launchPersistentContext(profile, {
          executablePath: path.resolve(browser),
          chromiumSandbox: true,
          headless: true,
          viewport: mobile ? { width: 390, height: 844 } : null,
          isMobile: mobile,
          hasTouch: mobile,
          locale: "en-US",
          timezoneId: "UTC",
          colorScheme: "light",
          reducedMotion: "reduce",
          offline: true,
          recordVideo: { dir: path.join(output, "video") },
          args: [
            `--window-size=${width},900`,
            "--disable-background-networking",
          ],
          timeout: 15000,
        });
        /** @type {string[]} */
        const blocked = [];
        /** @type {string[]} */
        const errors = [];
        await context.route("**/*", (r) =>
          r.request().url().startsWith("file:")
            ? r.continue()
            : (blocked.push(r.request().url()), r.abort()),
        );
        const page = await context.newPage();
        const session = await context.newCDPSession(page);
        const commandLine = await session.send("Browser.getBrowserCommandLine");
        assert(
          !commandLine.arguments.some((arg) =>
            ["--no-sandbox", "--disable-setuid-sandbox"].includes(arg),
          ),
          "sandbox disabled",
        );
        page.on("pageerror", (e) => errors.push(String(e)));
        await page.goto(pathToFileURL(path.resolve(built, "index.html")).href);
        await page
          .locator('[data-domain-projection] [data-field="task"]')
          .waitFor();
        metrics[zoom] = await page.evaluate(() => ({
          cssZoom: getComputedStyle(document.documentElement).zoom,
          visualViewportScale: visualViewport?.scale ?? 1,
          outerWidth,
          dpr: devicePixelRatio,
          innerWidth,
        }));
        for (const id of states) {
          await page.selectOption("#scenario", id);
          await page.locator('[data-field="label"]').waitFor();
          const trigger = page.getByRole("button", {
            name: "Inspect evidence boundary",
          });
          await trigger.focus();
          const file = `${id}-${width}-${zoom}.png`;
          fs.writeFileSync(
            path.join(output, file),
            (await nativeBitmap(page, session, "full")).png,
          );
          // Repeat the same rendering after a distinct state to catch stale labels.
          const projection = await page
            .locator("[data-domain-projection]")
            .innerText();
          await page.selectOption(
            "#scenario",
            id === "fresh" ? "unknown" : "fresh",
          );
          await page.selectOption("#scenario", id);
          assert.equal(
            await page.locator("[data-domain-projection]").innerText(),
            projection,
          );
          await trigger.focus();
          const repeat = (await nativeBitmap(page, session, "full")).png;
          assert.equal(
            crypto.createHash("sha256").update(repeat).digest("hex"),
            sha(path.join(output, file)),
            "nondeterministic repeated capture",
          );
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          );
          assert(!overflow, "horizontal overflow");
          await page.keyboard.press("Enter");
          const dialog = page.getByRole("dialog");
          await dialog.waitFor();
          assert(
            await dialog
              .getByText(
                "No approval, takeover, send or retry endpoint is connected.",
              )
              .isVisible(),
          );
          fs.writeFileSync(
            path.join(output, `dialog-initial-${file}`),
            (await nativeBitmap(page, session, "viewport")).png,
          );
          for (let i = 0; i < 5; i++) {
            await page.keyboard.press("Tab");
            assert(
              await dialog.evaluate((e) => e.contains(document.activeElement)),
              "focus escaped modal",
            );
          }
          fs.writeFileSync(
            path.join(output, `dialog-${file}`),
            (await nativeBitmap(page, session, "viewport")).png,
          );
          await page.keyboard.press("Escape");
          await dialog.waitFor({ state: "hidden" });
          await page.waitForFunction(() =>
            document.activeElement?.classList.contains("inspect"),
          );
          assert(
            await trigger.evaluate((e) => document.activeElement === e),
            "Escape lost trigger focus",
          );
          for (const name of ["Cancel inspection", "Close inspection"]) {
            await trigger.click();
            await page.getByRole("button", { name, exact: true }).click();
            await dialog.waitFor({ state: "hidden" });
            await page.waitForFunction(() =>
              document.activeElement?.classList.contains("inspect"),
            );
            assert(
              await trigger.evaluate((e) => document.activeElement === e),
              "close lost trigger focus",
            );
          }
          assert.equal(
            await page.locator("[data-domain-projection]").innerText(),
            projection,
          );
          receipt.cases.push({
            id,
            width,
            zoom,
            actual: metrics[zoom],
            file,
            sha256: sha(path.join(output, file)),
            keyboard: "passed",
            repeat: "pixel-identical",
            overflow: false,
          });
          if (baseline) {
            const approved = path.join(baseline, file);
            assert(fs.existsSync(approved), "missing approved baseline");
            cp.execFileSync(
              "python3",
              [
                "-c",
                `from PIL import Image,ImageChops; import sys; a=Image.open(sys.argv[1]).convert('RGB'); b=Image.open(sys.argv[2]).convert('RGB'); assert a.size==b.size; d=ImageChops.difference(a,b); d.save(sys.argv[3]); assert d.getbbox() is None, 'baseline pixel mismatch'`,
                approved,
                path.join(output, file),
                path.join(output, `diff-${file}`),
              ],
              { timeout: 10000 },
            );
          }
        }
        assert.deepEqual(blocked, []);
        assert.deepEqual(errors, []);
        await page.close();
        await context.close();
        context = null;
      } finally {
        if (context) {
          await context.close();
          context = null;
        }
        fs.rmSync(profile, { recursive: true, force: true });
      }
    }
    if (!mobile) validatePair(metrics[100], metrics[200]);
    else assert.equal(metrics[100].innerWidth, 390);
  }
  receipt.status = "passed";
  receipt.baseline_comparison = baseline
    ? "passed-exact-pixels"
    : "not-run-no-approved-baseline";
})()
  .catch((e) => {
    receipt.status = "failed";
    receipt.error = String(e.stack || e);
    process.exitCode = 1;
  })
  .finally(() =>
    fs.writeFileSync(
      path.join(output, "evidence.json"),
      JSON.stringify(receipt, null, 2),
    ),
  );
