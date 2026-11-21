"use strict";
/* global require, __dirname, __filename, document, window, getComputedStyle, devicePixelRatio, innerWidth, innerHeight, outerWidth, visualViewport */
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");
const { zoomPreferences } = require("../../../tools/check_console_visuals.cjs");

/** @typedef {import("./capture-types").Scenario} Scenario */
/** @typedef {import("./capture-types").Subject} Subject */
/** @typedef {import("./capture-types").Page} Page */
/** @typedef {import("./capture-types").Context} Context */
const ROOT = path.resolve(__dirname, "../../..");
const PRODUCT = path.join(ROOT, "docs/product");
const FONT_DIR = "/System/Library/Fonts";
const ELECTED_CHROME = "158.0.8127.36";
const NODE = "v26.13.0";
const OS_BUILD = "26B123";
const PLAYWRIGHT = "1.58.2";
const LINK_ORIGIN =
  "https://github.com/newdarwindev/runspindle-console/blob/main/";
const DISABLED = /historical (white paper|presentation)/i;
const STATIC_CSS =
  "*{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}";

/** @type {import("./capture-types").Manifest} */
const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "scenarios.json"), "utf8"),
);
/** @type {Subject[]} */
const subjects = ["reference", "canonical"];
const sources = {
  reference: path.join(__dirname, "reference.html"),
  canonical: path.join(PRODUCT, "vision.html"),
};

function verifySourceMap() {
  /** @type {{ sections: { id: string }[]; rendering_assets: { id: string }[]; navigation: { id: string; disposition: string }[] }} */
  const reviewed = JSON.parse(
    fs.readFileSync(path.join(PRODUCT, "SRC-010-lift.json"), "utf8"),
  );
  assert.deepEqual(
    manifest.sections.filter((item) => !item.source).map((item) => item.id),
    reviewed.sections.map((item) => item.id),
  );
  assert.deepEqual(
    Object.keys(manifest.assets),
    reviewed.rendering_assets.map((item) => item.id),
  );
  assert.deepEqual(
    manifest.navigation.unavailable,
    reviewed.navigation
      .filter((item) => item.disposition !== "replaced")
      .map((item) => item.id),
  );
}

/** @param {string} file */
async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const bytes of fs.createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}

/** @param {string[]} files @param {string} base */
async function digestInventory(files, base) {
  const entries = [];
  for (const file of files)
    entries.push([path.relative(base, file), await hashFile(file)]);
  return Object.fromEntries(entries);
}

/** @param {string} root @returns {string[]} */
function filesIn(root) {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .flatMap((entry) => {
      const file = path.join(root, entry.name);
      if (entry.isDirectory()) return filesIn(file);
      assert.ok(entry.isFile(), "unexpected linked toolchain file");
      return [file];
    });
}

/** @param {Record<string, string>} options */
async function toolchain(options) {
  const browser = fs.realpathSync(options.browser);
  const corePackage = require.resolve("playwright-core/package.json", {
    paths: [options.playwright],
  });
  const coreRoot = path.dirname(corePackage);
  const version = execFileSync(browser, ["--version"], {
    encoding: "utf8",
    timeout: 5000,
  }).trim();
  assert.equal(version, "Google Chrome " + ELECTED_CHROME);
  const osBuild = execFileSync("sw_vers", ["-buildVersion"], {
    encoding: "utf8",
    timeout: 5000,
  }).trim();
  assert.equal(osBuild, OS_BUILD);
  assert.equal(process.platform, "darwin");
  assert.equal(process.arch, "arm64");
  assert.equal(process.version, NODE);
  assert.equal(
    require(path.join(options.playwright, "package.json")).version,
    PLAYWRIGHT,
  );
  assert.equal(require(corePackage).version, PLAYWRIGHT);
  const framework = path.resolve(
    path.dirname(browser),
    "../Frameworks/Google Chrome Framework.framework/Versions/Current",
  );
  return {
    browser,
    pins: {
      browser_version: ELECTED_CHROME,
      browser_launcher_sha256: await hashFile(browser),
      chrome_framework_sha256: await hashFile(
        path.join(framework, "Google Chrome Framework"),
      ),
      node: NODE,
      node_sha256: await hashFile(process.execPath),
      playwright: PLAYWRIGHT,
      playwright_sha256: createHash("sha256")
        .update(
          JSON.stringify(
            await digestInventory(
              filesIn(options.playwright),
              options.playwright,
            ),
          ),
        )
        .digest("hex"),
      playwright_core_sha256: createHash("sha256")
        .update(
          JSON.stringify(await digestInventory(filesIn(coreRoot), coreRoot)),
        )
        .digest("hex"),
      os: { platform: process.platform, build: osBuild, arch: process.arch },
      local_fonts: await digestInventory(
        [
          "SFNS.ttf",
          "SFNSItalic.ttf",
          "Supplemental/Arial.ttf",
          "Supplemental/Arial Bold.ttf",
          "Supplemental/Georgia.ttf",
        ].map((file) => path.join(FONT_DIR, file)),
        FONT_DIR,
      ),
      locale: "en-US",
      timezone: "UTC",
      color_scheme: "light",
    },
  };
}

/** @param {Page} page */
async function geometry(page) {
  const metrics = await page.evaluate(() => {
    const root = document.documentElement;
    const overflow = [
      ...document.querySelectorAll(
        "header, main, footer, section, article, li, h1, p, a",
      ),
    ]
      .filter((node) => {
        if (!(node instanceof window.HTMLElement)) return false;
        const r = node.getBoundingClientRect();
        return (
          r.left < -1 ||
          r.right > innerWidth + 1 ||
          (node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 1)
        );
      })
      .map((node) => node.id || node.tagName);
    return {
      width: innerWidth,
      height: innerHeight,
      outer: outerWidth,
      dpr: devicePixelRatio,
      scroll: root.scrollWidth,
      scale: visualViewport?.scale,
      css_zoom: getComputedStyle(document.body).zoom,
      overflow,
    };
  });
  assert.deepEqual(metrics.overflow, [], "horizontal clipping or overflow");
  assert.ok(metrics.scroll <= metrics.width, "horizontal document overflow");
  return metrics;
}

/** @param {Page} page @param {Subject} subject */
async function contentChecks(page, subject) {
  for (const { id, [subject]: selector } of manifest.sections) {
    const node = page.locator(selector);
    assert.equal(await node.count(), 1, "missing or duplicate section " + id);
    assert.ok(await node.isVisible(), "hidden section " + id);
  }
  const content = (await page.locator("body").innerText()).toLowerCase();
  for (const label of manifest.expected[subject])
    assert.ok(content.includes(label.toLowerCase()), "missing label " + label);
  const shape = await page.evaluate(() => ({
    headings: [...document.querySelectorAll("h1,h2,h3")].map((h) =>
      Number(h.tagName[1]),
    ),
    stages: [...document.querySelectorAll("#refinement-loop ol > li")].map(
      (node) => node.id,
    ),
    warningLinks: [...document.querySelectorAll("#materials a")].map(
      (node) => node.textContent ?? "",
    ),
    runtime: document.querySelectorAll(
      "form, script, img, canvas, svg, iframe, details, [aria-expanded], link[rel=stylesheet]",
    ).length,
    alt: document.querySelector("figure figcaption")?.textContent ?? null,
    hrefs: [...document.querySelectorAll("a")].map(
      (node) => node.getAttribute("href") ?? "",
    ),
  }));
  assert.equal(shape.headings[0], 1);
  assert.equal(shape.headings.filter((x) => x === 1).length, 1);
  assert.ok(
    shape.headings.every((x, i) => i === 0 || x <= shape.headings[i - 1] + 1),
    "heading level skipped",
  );
  assert.deepEqual(
    shape.stages,
    manifest.sections
      .filter((item) => item.id.startsWith("loop-"))
      .map((item) => item.id.slice(5)),
  );
  assert.ok(
    !shape.warningLinks.some((text) => DISABLED.test(text)),
    "an unavailable material is linked",
  );
  assert.equal(shape.runtime, 0);
  if (subject === "reference")
    assert.match(shape.alt ?? "", /Read the seven stages in order/);
  const expectedExternal = manifest.navigation.external.map(
    (href) => LINK_ORIGIN + href,
  );
  assert.deepEqual(
    shape.hrefs.filter((href) => href.startsWith("http")),
    expectedExternal,
  );
  const local = shape.hrefs.filter(
    (href) => !href.startsWith("http") && !href.startsWith("#"),
  );
  assert.deepEqual(
    [...new Set(local.map((href) => path.basename(href)))].sort(),
    [...manifest.navigation.local, path.basename(sources[subject])].sort(),
  );
  for (const href of local) {
    const target = path.resolve(path.dirname(sources[subject]), href);
    assert.ok(target === sources[subject] || path.dirname(target) === PRODUCT);
    assert.ok(fs.statSync(target).isFile());
  }
  return shape;
}

/** @param {string} value */
function luminance(value) {
  const rgb = value.match(/^rgb\((\d+), (\d+), (\d+)\)$/);
  assert.ok(rgb, "expected an opaque computed CSS color");
  return rgb
    .slice(1)
    .map(Number)
    .map((n) => {
      const value = n / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0);
}

/** @param {string} foreground @param {string} background */
function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  );
  return (values[0] + 0.05) / (values[1] + 0.05);
}

/** @param {Page} page @param {Subject} subject */
async function contrastChecks(page, subject) {
  const checked = await page.evaluate(
    (badge) => {
      const pairs = [
        document.body,
        document.querySelector(badge),
        ...document.querySelectorAll(
          "p, h1, h2, h3, li, a, figcaption, footer",
        ),
      ];
      return pairs.map((element) => {
        if (!element) throw Error("missing contrast target");
        let background = "rgba(0, 0, 0, 0)";
        /** @type {Element | null} */
        let layer = element;
        for (
          ;
          layer && background === "rgba(0, 0, 0, 0)";
          layer = layer.parentElement
        )
          background = getComputedStyle(layer).backgroundColor;
        return [getComputedStyle(element).color, background];
      });
    },
    subject === "reference" ? "#limits" : ".badge",
  );
  return checked.map(([fg, bg]) => {
    const ratio = contrast(fg, bg);
    assert.ok(ratio >= 4.5, "insufficient text contrast");
    return Math.round(ratio * 100) / 100;
  });
}

/** @param {Page} page @param {Context} context @param {boolean} full */
async function bitmap(page, context, full) {
  const session = await context.newCDPSession(page);
  const metrics = await session.send("Page.getLayoutMetrics");
  const zoom = metrics.visualViewport.zoom;
  assert.ok(zoom !== undefined);
  const { width, height } = full
    ? metrics.contentSize
    : {
        width: metrics.layoutViewport.clientWidth,
        height: metrics.layoutViewport.clientHeight,
      };
  const image = await session.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: full,
    ...(full ? { clip: { x: 0, y: 0, width, height, scale: 1 } } : {}),
  });
  const png = Buffer.from(image.data, "base64");
  assert.equal(png.toString("ascii", 12, 16), "IHDR");
  assert.equal(png.readUInt32BE(16), width);
  assert.equal(png.readUInt32BE(20), height);
  return { png, zoom, width, height };
}

/** @param {Page} page */
async function focus(page) {
  return page.evaluate(() => {
    const item = document.activeElement;
    if (!item) throw new Error("missing focus");
    const visibleFragment = [...item.getClientRects()].some((rect) => {
      if (rect.top < -1 || rect.bottom > innerHeight + 1) return false;
      return item.contains(
        document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        ),
      );
    });
    const css = getComputedStyle(item);
    return {
      href: item.getAttribute("href"),
      id: item.id,
      name: item.getAttribute("aria-label") ?? item.textContent?.trim(),
      visible:
        item.matches(":focus-visible") &&
        css.outlineStyle !== "none" &&
        parseFloat(css.outlineWidth) >= 2 &&
        visibleFragment,
    };
  });
}

/** @param {Page} page @param {string[]} hrefs */
async function keyboard(page, hrefs) {
  for (const href of hrefs) {
    await page.keyboard.press("Tab");
    const target = await focus(page);
    assert.equal(target.href, href, "unexpected Tab order");
    assert.ok(
      target.visible && target.name,
      "missing or obscured named focus on " + href,
    );
  }
  await page.keyboard.press("Shift+Tab");
  assert.equal(
    (await focus(page)).href,
    hrefs.at(-2),
    "unexpected reverse order",
  );
  await page.goto(page.url());
  await page.keyboard.press("Tab");
  assert.equal((await focus(page)).href, manifest.navigation.skip);
  await page.keyboard.press("Enter");
  assert.equal((await focus(page)).id, "main", "skip link did not focus main");
}

/** @param {Page} page @param {Subject} subject */
async function projections(page, subject) {
  const snapshot = await page.locator("body").ariaSnapshot();
  assert.match(
    snapshot,
    /heading "Human-guided workflow evaluation" \[level=1\]/,
  );
  assert.match(snapshot, /navigation "Product documents"/);
  assert.match(snapshot, /link "Skip to content"/);
  assert.match(snapshot, /main:/);
  assert.match(snapshot, /contentinfo:/);
  if (subject === "reference")
    assert.match(snapshot, /figure "The refinement loop"/);
  return snapshot;
}

/** @param {Page} page @param {Context} context @param {Subject} subject @param {string} output */
async function probe(page, context, subject, output) {
  const title = page.locator("h1");
  await title.evaluate((el) => {
    el.textContent =
      "Human-guided workflow evaluation across multiple teams with durable review and authorization";
  });
  await geometry(page);
  const longLabel = await bitmap(page, context, false);
  fs.writeFileSync(
    path.join(output, `${subject}-long-heading.png`),
    longLabel.png,
  );

  const badge = page.locator(subject === "reference" ? "#limits" : ".badge");
  await badge.evaluate((el) => {
    el.textContent = "";
  });
  await assert.rejects(
    () => contentChecks(page, subject),
    subject === "reference"
      ? /missing label Design reference/
      : /missing label Design narrative/,
  );
  return "long_heading_passed_missing_label_detected";
}

/** @param {import("./capture-types").Chromium} chromium @param {string} binary @param {Scenario} scenario @param {Set<string>} allowed @param {(context: Context) => Promise<unknown>} visit */
async function isolated(
  chromium,
  binary,
  scenario,
  allowed,
  visit,
  software = false,
) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "vision-reference-"));
  /** @type {Context | undefined} */
  let context;
  try {
    fs.mkdirSync(path.join(profile, "Default"));
    fs.writeFileSync(
      path.join(profile, "Default", "Preferences"),
      JSON.stringify(zoomPreferences(scenario.zoom)),
    );
    const normal = scenario.zoom === 100;
    context = await chromium.launchPersistentContext(profile, {
      executablePath: binary,
      chromiumSandbox: true,
      headless: true,
      viewport: normal
        ? { width: scenario.width, height: scenario.height }
        : null,
      ...(normal ? { deviceScaleFactor: 1 } : {}),
      locale: "en-US",
      timezoneId: "UTC",
      colorScheme: "light",
      reducedMotion: "reduce",
      offline: true,
      timeout: 15000,
      args: [
        `--window-size=${scenario.width},${scenario.height}`,
        "--disable-background-networking",
        "--host-resolver-rules=MAP * ~NOTFOUND",
        ...(software ? ["--disable-gpu"] : []),
      ],
    });
    assert.equal(context.browser()?.version(), ELECTED_CHROME);
    /** @type {string[]} */
    const denied = [];
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.protocol === "file:" && allowed.has(fileURLToPath(url)))
        return route.continue();
      denied.push(url.protocol);
      return route.abort();
    });
    const results = await visit(context);
    assert.deepEqual(denied, [], "unexpected page resource");
    return results;
  } finally {
    try {
      if (context) await context.close();
    } finally {
      fs.rmSync(profile, { recursive: true });
    }
  }
}

/** @param {Context} context @param {Subject} subject @param {Scenario} scenario @param {string} output */
async function render(context, subject, scenario, output) {
  const page = await context.newPage();
  try {
    page.setDefaultTimeout(5000);
    const sourceUrl = pathToFileURL(sources[subject]).href;
    await page.goto(sourceUrl);
    await page.addStyleTag({ content: STATIC_CSS });
    await page.evaluate(() => document.fonts.ready);
    const shape = await contentChecks(page, subject);
    const found = await geometry(page);
    const percent = scenario.zoom / 100;
    assert.equal(found.width, scenario.width / percent);
    assert.equal(found.dpr, percent);
    assert.equal(found.css_zoom, "1");
    assert.equal(found.scale, 1);
    if (scenario.zoom === 200) assert.equal(found.outer, scenario.width);
    const captured = await bitmap(page, context, true);
    assert.equal(captured.zoom, percent);
    assert.equal(captured.width, scenario.width);
    const filename = `${subject}-${scenario.id}.png`;
    fs.writeFileSync(path.join(output, filename), captured.png);
    const snapshot = await projections(page, subject);
    const ratios = await contrastChecks(page, subject);
    await keyboard(page, shape.hrefs);
    if (scenario.id === "desktop-1440") {
      await page.goto(sourceUrl);
      await page.keyboard.press("Tab");
      assert.ok((await focus(page)).visible);
      const focused = await bitmap(page, context, false);
      fs.writeFileSync(path.join(output, `${subject}-focus.png`), focused.png);
      await page.goto(sourceUrl);
      await page.hover("nav a[href$='index.html']");
      const hovered = await bitmap(page, context, false);
      fs.writeFileSync(path.join(output, `${subject}-hover.png`), hovered.png);
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      await page.waitForURL(
        pathToFileURL(path.join(PRODUCT, "index.html")).href,
      );
      await page.goto(sourceUrl + "#refinement-loop");
      const workflow = await bitmap(page, context, false);
      fs.writeFileSync(
        path.join(output, `${subject}-workflow.png`),
        workflow.png,
      );
    }
    let mutation = null;
    if (scenario.id === "mobile-320") {
      await page.goto(sourceUrl);
      mutation = await probe(page, context, subject, output);
    }
    return {
      subject,
      filename,
      geometry: found,
      browser_zoom: captured.zoom,
      png_dimensions: [captured.width, captured.height],
      keyboard: "tab_all_links_reverse_skip_focus",
      desktop_overview_activation:
        scenario.id === "desktop-1440" ? "passed" : "not_run",
      headings: shape.headings,
      stage_ids: shape.stages,
      navigation: shape.hrefs,
      minimum_sample_contrast: Math.min(...ratios),
      accessibility_sha256: createHash("sha256").update(snapshot).digest("hex"),
      mutation,
    };
  } finally {
    await page.close();
  }
}

/** @param {string} file @param {string} output */
function contactSheet(file, output) {
  const pairs = manifest.cases.map(
    (item) =>
      `<section><h2>${item.id} · ${item.zoom}%</h2><div>${subjects
        .map((subject) => {
          const png = `${subject}-${item.id}.png`;
          const url = pathToFileURL(path.join(output, png)).href;
          return `<figure><figcaption>${subject}</figcaption><img src="${url}" alt="Top of ${subject} page"></figure>`;
        })
        .join("")}</div></section>`,
  );
  fs.writeFileSync(
    file,
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>SRC-010 contact sheet</title>
    <style>body{font:16px Arial,sans-serif;background:#ece9df;color:#18332c;margin:32px}main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}section{background:#fff;padding:10px}section div{display:grid;grid-template-columns:1fr 1fr;gap:10px}h2{font-size:16px;margin:5px 0 12px}figure{margin:0}figcaption{margin:0 0 6px;text-transform:capitalize}img{display:block;width:100%;height:260px;object-fit:cover;object-position:top;border:1px solid #ccc}</style>
    <h1>Refinery vision · Paired page previews</h1><main>${pairs.join("")}</main></html>`,
  );
}

/** @param {Record<string, string>} options */
async function generate(options) {
  const output = path.resolve(options.output);
  verifySourceMap();
  const pins = await toolchain(options);
  // Both packages are explicit, offline inputs from the existing Console UI lock.
  /** @type {import("./capture-types").Chromium} */
  const chromium = require(options.playwright).chromium;
  const baselineInputs = [
    ...Object.values(sources),
    path.join(__dirname, "scenarios.json"),
    __filename,
    path.join(__dirname, "capture-types.d.ts"),
    path.join(ROOT, "ui/package-lock.json"),
    path.join(ROOT, "tools/check_console_visuals.cjs"),
    ...fs.readdirSync(PRODUCT).map((file) => path.join(PRODUCT, file)),
  ];
  const inputs = await digestInventory(
    [...new Set(baselineInputs)].sort(),
    ROOT,
  );
  fs.mkdirSync(output);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "vision-sheet-"));
  const sheet = path.join(scratch, "sheet.html");
  const allowed = new Set([
    ...Object.values(sources),
    ...fs.readdirSync(PRODUCT).map((file) => path.join(PRODUCT, file)),
  ]);
  const results = [];
  try {
    for (const scenario of manifest.cases) {
      results.push(
        await isolated(
          chromium,
          pins.browser,
          scenario,
          allowed,
          async (context) => {
            const rows = [];
            for (const subject of subjects)
              rows.push(await render(context, subject, scenario, output));
            return { scenario, rows };
          },
        ),
      );
    }
    contactSheet(sheet, output);
    for (const file of fs.readdirSync(output))
      allowed.add(path.join(output, file));
    allowed.add(sheet);
    await isolated(
      chromium,
      pins.browser,
      manifest.cases[3],
      allowed,
      async (context) => {
        const page = await context.newPage();
        await page.goto(pathToFileURL(sheet).href);
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all([...document.images].map((img) => img.decode()));
          await new Promise((resolve) =>
            window.requestAnimationFrame(() =>
              window.requestAnimationFrame(resolve),
            ),
          );
        });
        const shot = await bitmap(page, context, true);
        fs.writeFileSync(path.join(output, "contact-sheet.png"), shot.png);
      },
      true,
    );
    const hashes = await digestInventory(filesIn(output), output);
    fs.writeFileSync(
      path.join(output, "evidence.json"),
      JSON.stringify(
        {
          evidence_class: "local_static_document_and_reference_candidate",
          status: "captured_programmatic_checks_passed",
          reviewer_disposition: "pending_owner_baseline_approval",
          thresholds: {
            minimum_sample_text_contrast: 4.5,
            horizontal_overflow_pixels: 0,
          },
          pixel_diff: "pending_baseline_approval",
          actual_runtime_ui: "not_run",
          toolchain: pins.pins,
          inputs,
          cases: results,
          output_sha256: hashes,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    fs.rmSync(scratch, { recursive: true });
  }
}

const args = process.argv.slice(2);
assert.equal(
  args.length,
  6,
  "--browser PATH --playwright PATH --output NEW_DIRECTORY",
);
const options = Object.fromEntries(
  [0, 2, 4].map((index) => [args[index], args[index + 1]]),
);
assert.ok(
  options["--browser"] && options["--playwright"] && options["--output"],
);
generate({
  browser: path.resolve(options["--browser"]),
  playwright: path.resolve(options["--playwright"]),
  output: options["--output"],
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
