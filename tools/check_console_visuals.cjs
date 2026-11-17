#!/usr/bin/env node
/// <reference path="./console-visual-browser-types.d.ts" />
"use strict";
/* global require, module, __dirname, document, window, history, devicePixelRatio, innerWidth, outerWidth, innerHeight, outerHeight, visualViewport, getComputedStyle, scrollX, scrollY, scrollTo, consoleVisual, runAssertions, requestAnimationFrame, createStreamProjection, consoleScenarios, keyboardReceipt, createTaskNavigator, consoleTaskCatalog, createBrowserTaskHistory, keyboardNavigator */
// Synthetic Console reference capture. No runtime authority or baseline self-approval.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const ROOT = path.resolve(__dirname, "..");
/** @param {string | Uint8Array} bytes */
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
/** @param {string} file */
const fileHash = (file) => sha(fs.readFileSync(file));
/** @param {string} directory */
function inventory(directory) {
  /** @type {Record<string,string | {symlink:string}>} */
  const result = {};
  /** @param {string} folder */
  function visit(folder) {
    for (const entry of fs
      .readdirSync(folder, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(folder, entry.name),
        relative = path.relative(directory, full);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) result[relative] = fileHash(full);
      else if (entry.isSymbolicLink())
        result[relative] = { symlink: fs.readlinkSync(full) };
      else throw Error("unsupported distribution file");
    }
  }
  visit(directory);
  return { files: result, inventory_sha256: sha(JSON.stringify(result)) };
}
/** @param {number} percent */
function zoomPreferences(percent) {
  assert.ok(percent === 100 || percent === 200);
  return {
    partition: {
      default_zoom_level: { x: Math.log(percent / 100) / Math.log(1.2) },
    },
  };
}
/** @param {import("./console-visual-browser-types").Metrics} normal @param {import("./console-visual-browser-types").Metrics} zoomed */
function validatePair(normal, zoomed) {
  assert.equal(normal.cssZoom, "1");
  assert.equal(zoomed.cssZoom, "1");
  assert.equal(normal.visualViewportScale, 1);
  assert.equal(zoomed.visualViewportScale, 1);
  assert.equal(zoomed.outerWidth, normal.outerWidth);
  assert.ok(
    Math.abs(zoomed.dpr / normal.dpr - 2) < 0.001,
    "native DPR must double",
  );
  assert.ok(
    Math.abs(normal.innerWidth / zoomed.innerWidth - 2) < 0.01,
    "CSS viewport must halve",
  );
}
/** @param {Pick<import("./console-visual-browser-types").Pixels,"size" | "color_count_lower_bound">} pixels @param {{width:number,height:number}} expected */
function validateBitmap(pixels, expected) {
  assert.ok(
    Math.abs(pixels.size[0] - expected.width) <= 1 &&
      Math.abs(pixels.size[1] - expected.height) <= 1,
    "captured bitmap is incomplete",
  );
  assert.ok(pixels.color_count_lower_bound >= 8, "captured bitmap is blank");
}
/** @param {Uint8Array} png @returns {import("./console-visual-browser-types").Pixels} */
function pixelsOf(png) {
  return JSON.parse(
    cp
      .execFileSync(
        "python3",
        [
          "-B",
          "-c",
          'import sys,io,hashlib,json; from PIL import Image; im=Image.open(io.BytesIO(sys.stdin.buffer.read())).convert("RGB"); c=im.getcolors(256); print(json.dumps(dict(size=im.size,rgb_sha256=hashlib.sha256(im.tobytes()).hexdigest(),color_count_lower_bound=len(c) if c is not None else 257)))',
        ],
        { input: png, timeout: 10000 },
      )
      .toString(),
  );
}
/** @param {unknown} value @returns {number} */
function validateNativeZoom(value) {
  assert.ok(
    typeof value === "number" && Number.isFinite(value) && value > 0,
    "missing or invalid native CDP zoom",
  );
  return value;
}
/** @param {import("./console-visual-browser-types").Page} page @param {import("./console-visual-browser-types").Session} session @param {"full" | "card" | "viewport"} mode @param {string} [selector] */
async function nativeBitmap(page, session, mode, selector) {
  const metrics = await session.send("Page.getLayoutMetrics");
  const zoom = validateNativeZoom(metrics.visualViewport.zoom);
  /** @type {{x:number,y:number,width:number,height:number,scale:number}|undefined} */
  let clip;
  /** @type {{width:number,height:number}} */
  let expected;
  if (mode === "full") {
    clip = {
      x: 0,
      y: 0,
      width: metrics.contentSize.width,
      height: metrics.contentSize.height,
      scale: 1,
    };
    expected = clip;
    const extent = await page.evaluate(() => ({
      right: Math.max(
        ...[...document.querySelectorAll("#reference, #reference *")].map(
          (e) => e.getBoundingClientRect().right + scrollX,
        ),
      ),
      bottom:
        (() => {
          const reference = document.querySelector("#reference");
          if (!reference) throw Error("missing reference");
          return reference.getBoundingClientRect().bottom;
        })() + scrollY,
    }));
    assert.ok(
      extent.right * zoom <= clip.width + 1 &&
        extent.bottom * zoom <= clip.height + 1,
      "full bitmap omits renderer content",
    );
  } else if (mode === "card") {
    assert.ok(selector, "card selector required");
    const rect = await page.locator(selector).evaluate((e) => {
      const r = e.getBoundingClientRect();
      return {
        x: r.x + scrollX,
        y: r.y + scrollY,
        width: r.width,
        height: r.height,
      };
    });
    clip = {
      x: rect.x * zoom,
      y: rect.y * zoom,
      width: rect.width * zoom,
      height: rect.height * zoom,
      scale: 1,
    };
    expected = clip;
  } else {
    assert.equal(mode, "viewport");
    expected = {
      width: metrics.layoutViewport.clientWidth,
      height: metrics.layoutViewport.clientHeight,
    };
  }
  const result = await session.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: mode !== "viewport",
    ...(clip ? { clip } : {}),
  });
  const png = Buffer.from(result.data, "base64"),
    pixels = pixelsOf(png);
  validateBitmap(pixels, expected);
  return {
    png,
    pixels,
    capture: {
      mode,
      zoom,
      expected,
      coordinate_space: "Chrome_layout_metrics_DIP_not_CSS_pixels",
    },
  };
}
/** @param {import("./console-visual-browser-types").Page} page @param {ReturnType<typeof import("../visual/build.mjs").build>["manifest"]["scenarios"][number]} scenario */
async function pageChecks(page, scenario) {
  assert.equal(
    await page.locator("body").getAttribute("data-scenario"),
    scenario.id,
  );
  const text = await page.locator("#reference").innerText();
  assert.ok(text.includes("SIMULATED"), "missing simulation warning");
  for (const label of scenario.expected_visible)
    assert.ok(text.includes(label), "missing expected label: " + label);
  for (const [key, value] of Object.entries(scenario.expected_fields || {}))
    assert.equal(
      await page.locator(`[data-visual-field="${key}"]`).innerText(),
      value,
      "visual field " + key,
    );
  for (const [key, value] of Object.entries(scenario.expected_projection))
    assert.equal(
      await page.locator(`#projection [data-field="${key}"]`).textContent(),
      value,
      "projection field " + key,
    );
  assert.equal(
    await page.locator("#projection [role=status]").innerText(),
    "Status: " + scenario.expected_status,
  );
  assert.equal(
    await page.locator("[data-authority-action]").count(),
    scenario.expected_actions.length,
    "missing authority action",
  );
  for (const action of scenario.expected_actions) {
    const button = page.locator("#" + action.id);
    assert.equal(await button.innerText(), action.label);
    assert.ok(await button.isDisabled());
    assert.equal(
      await button.getAttribute("aria-describedby"),
      action.reason_id,
      "missing reason association",
    );
    const reason = page.locator("#" + action.reason_id);
    assert.equal(
      await reason.innerText(),
      action.reason,
      "missing reason text",
    );
    assert.ok(await reason.isVisible());
  }
  assert.equal(await page.locator("h1").count(), 1);
  assert.ok((await page.locator("#reference h2").count()) >= 3);
  assert.ok(
    (
      await page.locator("#simulated-frame").getAttribute("aria-label")
    )?.includes("SIMULATED"),
    "diagram alternative missing",
  );
  const contrast = await page.evaluate(() => {
    /** @param {string} value */
    const rgb = (value) => {
      const n = value.match(/[\d.]+/g)?.map(Number);
      return n && n.length >= 3 ? n : null;
    };
    /** @param {number[]} v */
    const luminance = (v) =>
      v
        .slice(0, 3)
        .map((c) => {
          const n = c / 255;
          return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
        })
        .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    const findings = [];
    for (const e of document.querySelectorAll("body *")) {
      if (
        (![...e.childNodes].some(
          (n) => n.nodeType === 3 && n.textContent?.trim(),
        ) &&
          !(e instanceof window.HTMLSelectElement)) ||
        !e.getClientRects().length ||
        getComputedStyle(e).visibility === "hidden"
      )
        continue;
      const style = getComputedStyle(e),
        fg = rgb(style.color);
      /** @type {Element | null} */
      let parent = e;
      /** @type {number[] | null} */
      let bg = null;
      while (parent && !bg) {
        const c = rgb(getComputedStyle(parent).backgroundColor);
        if (c && (c.length === 3 || c[3] === 1)) bg = c;
        parent = parent.parentElement;
      }
      if (!fg || !bg) throw Error("unresolved text contrast");
      const a = luminance(fg),
        b = luminance(bg),
        ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const large =
        parseFloat(style.fontSize) >= 24 ||
        (parseFloat(style.fontSize) >= 18.66 &&
          parseInt(style.fontWeight) >= 700);
      findings.push({ tag: e.tagName, ratio, minimum: large ? 3 : 4.5 });
    }
    return findings;
  });
  assert.ok(
    contrast.length > 0 && contrast.every((r) => r.ratio >= r.minimum),
    "text contrast below threshold",
  );
  const metrics = await page.evaluate(() => ({
    cssZoom: getComputedStyle(document.documentElement).zoom,
    visualViewportScale: (() => {
      if (!visualViewport) throw Error("missing native visual viewport");
      return visualViewport.scale;
    })(),
    dpr: devicePixelRatio,
    innerWidth,
    outerWidth,
    innerHeight,
    outerHeight,
    overflow: [
      ...document.querySelectorAll(
        "#reference,header,.selector,dialog,h1,h2,dd,button,p,select",
      ),
    ]
      .filter(
        (e) =>
          getComputedStyle(e).visibility !== "hidden" &&
          e.clientWidth > 0 &&
          e.scrollWidth > e.clientWidth + 1,
      )
      .map((e) => e.getAttribute("data-visual-field") || e.tagName),
    actions: [...document.querySelectorAll("[data-authority-action]")].map(
      (e) => ({
        disabled: (() => {
          if (!(e instanceof window.HTMLButtonElement))
            throw Error("authority action is not button");
          return e.disabled;
        })(),
        reason: e.getAttribute("aria-describedby") || e.getAttribute("title"),
      }),
    ),
  }));
  assert.deepEqual(metrics.overflow, [], "horizontal clipping");
  assert.equal(metrics.cssZoom, "1");
  assert.equal(metrics.visualViewportScale, 1);
  assert.ok(
    metrics.actions.every((a) => a.disabled),
    "authority action must remain disabled",
  );
  return { ...metrics, contrast };
}
/** @param {Pick<import("./console-visual-browser-types").Pixels,"size" | "rgb_sha256">} a @param {Pick<import("./console-visual-browser-types").Pixels,"size" | "rgb_sha256">} b */
function comparePixels(a, b) {
  assert.deepEqual(a.size, b.size, "pixel dimensions differ");
  assert.equal(a.rgb_sha256, b.rgb_sha256, "pixel mutation or drift");
}
/** @param {import("./console-visual-browser-types").Context} context @param {string} output */
async function componentAssertions(context, output) {
  const names = [
    "src/projection.js",
    "src/view.js",
    "src/stream.js",
    "src/navigation.js",
    "fixtures/console-ui/scenarios.js",
    "test/view.assertions.js",
    "test/navigation-browser.assertions.js",
  ];
  const source = names
    .map((name) =>
      fs
        .readFileSync(path.join(ROOT, name), "utf8")
        .replace(/^import \{[^\n]+\} from "\.\/[^"\n]+";\n/gm, "")
        .replaceAll("export ", ""),
    )
    .join("\n");
  const filename = path.join(output, "component-assertions.html");
  fs.writeFileSync(
    filename,
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>Synthetic component assertions</title><body><script>${source.replaceAll("</script", "<\\/script")}\nglobalThis.runAssertions=async()=>({projection:await assertProjectionDom(document,createProjectionView,createProjection,consoleScenarios),navigation:await assertNavigationBrowser(window,createTaskNavigator,createBrowserTaskHistory,createStreamProjection,consoleScenarios,consoleTaskCatalog)});</script></body></html>`,
  );
  const page = await context.newPage();
  try {
    await page.goto(pathToFileURL(filename).href);
    const checks = await page.evaluate(() => runAssertions());
    await page.evaluate(() => {
      globalThis.keyboardReceipt = {
        subscriptions: 0,
        closes: 0,
        passive: 0,
        trusted: [],
      };
      document.addEventListener("keydown", (e) =>
        keyboardReceipt.trusted.push(e.isTrusted),
      );
      const root = document.createElement("main");
      document.body.append(root);
      const stream = createStreamProjection({
        clock: () => 1000,
        subscribe: () => {
          keyboardReceipt.subscriptions++;
          return { close: () => keyboardReceipt.closes++ };
        },
        readSnapshot: (identity) => ({
          ...consoleScenarios.observation,
          identity,
        }),
        openPassive: () => {
          keyboardReceipt.passive++;
          throw Error("forbidden");
        },
      });
      globalThis.keyboardNavigator = createTaskNavigator(root, {
        catalog: [...consoleTaskCatalog],
        stream,
        history: createBrowserTaskHistory(window),
      });
    });
    const active = () => page.locator(":focus").getAttribute("data-task-key");
    await page.keyboard.press("Tab");
    assert.equal(await active(), "a");
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () =>
        document.querySelector("[data-field=task]")?.textContent === "task-a",
    );
    await page.keyboard.press("Tab");
    assert.equal(await active(), "b");
    await page.keyboard.press("Space");
    await page.waitForFunction(
      () =>
        document.querySelector("[data-field=task]")?.textContent === "task-b",
    );
    const before = await page.evaluate(() => ({
      length: history.length,
      subscriptions: keyboardReceipt.subscriptions,
    }));
    await page.keyboard.press("Space");
    assert.deepEqual(
      await page.evaluate(() => ({
        length: history.length,
        subscriptions: keyboardReceipt.subscriptions,
      })),
      before,
    );
    await page.keyboard.press("Tab");
    assert.ok(
      (await page.locator(":focus").getAttribute("data-retry-observation")) !==
        null,
    );
    await page.keyboard.press("Shift+Tab");
    assert.equal(await active(), "b");
    const trusted = await page.evaluate(() => keyboardReceipt.trusted);
    assert.ok(trusted.length > 0 && trusted.every(Boolean));
    assert.equal(await page.evaluate(() => keyboardReceipt.passive), 0);
    await page.evaluate(() => keyboardNavigator.dispose());
    assert.equal(
      await page.evaluate(() => keyboardReceipt.closes),
      await page.evaluate(() => keyboardReceipt.subscriptions),
    );
    return {
      ...checks,
      keyboard:
        "trusted Tab/Shift+Tab/Enter/Space; repeated selection; disposal",
    };
  } finally {
    await page.close();
  }
}
/** @param {string} output @param {string} filename @param {Uint8Array} png */
function repeatArtifacts(output, filename, png) {
  cp.execFileSync(
    "python3",
    [
      "-B",
      "-c",
      `import sys,io,pathlib; from PIL import Image,ImageChops
p=pathlib.Path(sys.argv[1]);a=Image.open(p).convert('RGB');b=Image.open(io.BytesIO(sys.stdin.buffer.read())).convert('RGB');d=ImageChops.difference(a,b);assert not d.getbbox();d.save(p.with_name('diff-'+p.name));Image.blend(a,b,.5).save(p.with_name('overlay-'+p.name))`,
      path.join(output, filename),
    ],
    { input: png, timeout: 10000 },
  );
}
/** @param {string} output @param {string[]} files */
function rasterSummary(output, files) {
  const script = `import json,sys,pathlib,hashlib\nfrom PIL import Image,ImageOps,ImageChops,ImageDraw\np=pathlib.Path(sys.argv[1]); names=json.loads(sys.argv[2]); thumbs=[]\nfor name in names:\n im=Image.open(p/name).convert('RGB'); im.thumbnail((320,500)); tile=Image.new('RGB',(340,540),'white');tile.paste(im,((340-im.width)//2,25)); ImageDraw.Draw(tile).text((5,510),name[:48],fill='black');thumbs.append(tile)\nout=Image.new('RGB',(340*4,540*((len(thumbs)+3)//4)), '#dddddd')\nfor i,im in enumerate(thumbs):out.paste(im,((i%4)*340,(i//4)*540))\nout.save(p/'contact-sheet.png')\n`;
  cp.execFileSync(
    "python3",
    ["-B", "-c", script, output, JSON.stringify(files)],
    { timeout: 30000 },
  );
}
/** @param {import("./console-visual-browser-types").Page} page @param {import("./console-visual-browser-types").Session} session @param {ReturnType<typeof import("../visual/build.mjs").build>["manifest"]["scenarios"][number]} scenario @param {string} output @param {boolean} capture */
async function interactionChecks(page, session, scenario, output, capture) {
  /** @type {import("./console-visual-browser-types").Interactions} */
  const results = {};
  const state = () => page.evaluate(() => consoleVisual.state());
  const before = await state();
  assert.equal(before.effects.passive, 0);
  assert.equal(before.effects.control, 0);
  // Actual keyboard activation, native dialog modal focus, cancellation and return focus.
  await page.locator("#scenario").focus();
  await page.keyboard.press("Tab");
  assert.equal(
    await page.locator(":focus").getAttribute("id"),
    "inspect-preview",
  );
  await page.keyboard.press("Enter");
  assert.ok(
    await page.locator("#preview-dialog").evaluate((e) => {
      if (!(e instanceof window.HTMLDialogElement))
        throw Error("missing native dialog");
      return e.open;
    }),
  );
  assert.equal(
    await page.locator(":focus").getAttribute("id"),
    "preview-cancel",
  );
  await pageChecks(page, scenario); // Include the actually open modal in visible-surface checks.
  const focused = await page.locator(":focus").evaluate((e) => ({
    rect: e.getBoundingClientRect().toJSON(),
    outline: getComputedStyle(e).outlineStyle,
    height: innerHeight,
  }));
  assert.notEqual(focused.outline, "none");
  assert.ok(
    focused.rect.top >= 0 && focused.rect.bottom <= focused.height,
    "modal focus obscured",
  );
  if (capture) {
    const cap = await nativeBitmap(page, session, "viewport");
    const file = "native-200-effective-390-preview-focus.png";
    const destination = path.join(output, file);
    if (fs.existsSync(destination))
      comparePixels(pixelsOf(fs.readFileSync(destination)), cap.pixels);
    else fs.writeFileSync(destination, cap.png);
    results.focus = { file, pixels: cap.pixels, capture: cap.capture };
  }
  await page.keyboard.press("Enter");
  assert.ok(
    !(await page.locator("#preview-dialog").evaluate((e) => {
      if (!(e instanceof window.HTMLDialogElement))
        throw Error("missing native dialog");
      return e.open;
    })),
  );
  assert.equal(
    await page.locator(":focus").getAttribute("id"),
    "inspect-preview",
  );
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  assert.equal(
    await page.locator(":focus").getAttribute("id"),
    "preview-close",
  );
  await page.keyboard.press("Space");
  assert.ok(
    !(await page.locator("#preview-dialog").evaluate((e) => {
      if (!(e instanceof window.HTMLDialogElement))
        throw Error("missing native dialog");
      return e.open;
    })),
  );
  assert.equal(
    await page.locator(":focus").getAttribute("id"),
    "inspect-preview",
  );
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  assert.ok(
    !(await page.locator("#preview-dialog").evaluate((e) => {
      if (!(e instanceof window.HTMLDialogElement))
        throw Error("missing native dialog");
      return e.open;
    })),
  );
  assert.equal(
    await page.locator(":focus").getAttribute("id"),
    "inspect-preview",
  );
  results.dialog = "trusted Enter/Space/Tab/Escape, Cancel/Close, focus return";
  if (scenario.interaction === "late-switch") {
    const task = () =>
      page.locator("#navigation-root [data-field=task]").innerText();
    assert.equal(await task(), "task-b");
    const old = await state();
    assert.equal(old.projection.identity.task, "task-b");
    assert.ok(
      old.effects.subscriptions >= 2 && old.effects.snapshots >= 2,
      "actual A/B observations must start before late response",
    );
    assert.equal(
      await page.locator("#navigation-root [data-field=label]").innerText(),
      "Synthetic task observation",
    );
    await page.locator("#late-response").click();
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert.equal(await task(), "task-b");
    assert.deepEqual((await state()).effects, old.effects);
    assert.equal((await state()).projection.identity.task, "task-b");
    results.late_response =
      "released actual held A after B, B identity preserved, no new effects";
  }
  if (
    ["history", "repeated"].includes(scenario.interaction) ||
    scenario.interaction === "late-switch"
  ) {
    const b = page.locator("#navigation-root [data-task-key=b]");
    const old = await state();
    const length = await page.evaluate(() => history.length);
    await b.click();
    await b.click();
    assert.equal(await page.evaluate(() => history.length), length);
    assert.deepEqual((await state()).effects, old.effects);
    await page.locator("#history-back").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#navigation-root [data-field=task]")
          ?.textContent === "task-a",
    );
    assert.equal(
      await page.locator(":focus").getAttribute("data-task-key"),
      "a",
    );
    await page.locator("#history-forward").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#navigation-root [data-field=task]")
          ?.textContent === "task-b",
    );
    assert.equal(
      await page.locator(":focus").getAttribute("data-task-key"),
      "b",
    );
    results.history =
      "actual Back/Forward focus restoration and repeated selection";
  }
  const after = await state();
  assert.equal(after.effects.passive, 0);
  assert.equal(after.effects.control, 0);
  results.effects = after.effects;
  return results;
}

/** @param {{output:string,browser:string,playwright:string}} options */
async function qualify(options) {
  const output = path.resolve(options.output),
    browser = fs.realpathSync(options.browser),
    packageRoot = fs.realpathSync(options.playwright);
  assert.ok(!fs.existsSync(output), "new output directory required");
  /** @type {{chromium:import("./console-visual-browser-types").Chromium}} */
  const { chromium } = require(packageRoot);
  const coreRoot = path.dirname(
    require.resolve("playwright-core/package.json", { paths: [packageRoot] }),
  );
  const browserElf = path.join(path.dirname(browser), "chrome");
  assert.ok(fs.existsSync(browserElf));
  const distributions = {
    playwright: inventory(packageRoot),
    playwright_core: inventory(coreRoot),
    browser: inventory(path.dirname(browser)),
  };
  cp.execFileSync(process.execPath, ["visual/build.mjs", "--output", output], {
    cwd: ROOT,
    timeout: 10000,
  });
  /** @type {ReturnType<typeof import("../visual/build.mjs").build>["manifest"]} */
  const manifest = JSON.parse(
    fs.readFileSync(path.join(output, "manifest.json"), "utf8"),
  );
  const scenarios = manifest.scenarios;
  assert.ok(
    Array.isArray(scenarios) && scenarios.length > 0,
    "scenario manifest required",
  );
  for (const [name, digest] of Object.entries(manifest.source_sha256))
    assert.equal(
      fileHash(path.join(ROOT, name)),
      digest,
      "manifest source digest mismatch",
    );
  const sourceNames = [
    ...Object.keys(manifest.source_sha256),
    "src/projection.js",
    "src/view.js",
    "src/stream.js",
    "src/navigation.js",
    "fixtures/console-ui/scenarios.js",
    "tools/check_console_visuals.cjs",
    "test/console-visual-harness.test.cjs",
    "test/view.assertions.js",
    "test/navigation-browser.assertions.js",
    "tests/probe_console_visuals.py",
    "tools/console-visual-browser-types.d.ts",
  ];
  const sources = Object.fromEntries(
    sourceNames.map((p) => [p, fileHash(path.join(ROOT, p))]),
  );
  const pythonInfo = JSON.parse(
    cp.execFileSync(
      "python3",
      [
        "-B",
        "-c",
        "import sys,json,PIL,PIL._imaging; print(json.dumps(dict(executable=sys.executable,pillow=PIL.__version__,imaging=PIL._imaging.__file__)))",
      ],
      { encoding: "utf8" },
    ),
  );
  const receipt = {
    schema: "console.native-visual-reference.v1",
    status: "running",
    baseline_approval: "candidate_not_approved",
    evidence_class: "synthetic_readonly_browser_reference",
    live_runtime: "not_qualified",
    desktop: "SIMULATED",
    source_commit: cp
      .execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: ROOT,
        encoding: "utf8",
      })
      .trim(),
    source_sha256: sources,
    environment: {
      python: cp
        .execFileSync("python3", ["--version"], { encoding: "utf8" })
        .trim(),
      python_binary_sha256: fileHash(pythonInfo.executable),
      pillow: pythonInfo.pillow,
      pillow_imaging_sha256: fileHash(pythonInfo.imaging),
      fonts: Object.fromEntries(
        [
          "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
          "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        ].map((p) => [path.basename(p), fileHash(p)]),
      ),
      node: process.version,
      node_sha256: fileHash(process.execPath),
      playwright: JSON.parse(
        fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
      ).version,
      browser_launcher_sha256: fileHash(browser),
      browser_elf_sha256: fileHash(browserElf),
      distributions,
      os: os.type() + " " + os.release() + " " + os.arch(),
      sandbox_enabled_requested: true,
      viewport_emulation: false,
      device_scale_emulation: false,
      css_zoom_modified: false,
      locale: "en-US",
      timezone: "UTC",
    },
    cases: /** @type {import("./console-visual-browser-types").Case[]} */ ([]),
    sha256: /** @type {Record<string,string>} */ ({}),
    failure: /** @type {string | undefined} */ (undefined),
    profiles_removed: 0,
    repeat_pixel_tolerance: 0,
  };
  /** @type {import("./console-visual-browser-types").Context | null} */
  let context = null;
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
    if (context) void context.close().catch(() => {});
  };
  process.on("SIGTERM", cancel);
  process.on("SIGINT", cancel);
  try {
    for (const width of [320, 390, 768, 1440, 640, 780, 1536, 2880]) {
      /** @type {Record<number,Record<string,import("./console-visual-browser-types").Shot>>} */
      const pair = {};
      for (const percent of [100, 200]) {
        /** @type {import("./console-visual-browser-types").Case | undefined} */
        let first;
        for (const repeat of [1, 2]) {
          if (cancelled) throw Error("qualification cancelled");
          const profile = fs.mkdtempSync(
            path.join(os.tmpdir(), "console-native-visual-"),
          );
          fs.mkdirSync(path.join(profile, "Default"));
          const preferences = JSON.stringify(zoomPreferences(percent));
          fs.writeFileSync(
            path.join(profile, "Default", "Preferences"),
            preferences,
          );
          try {
            context = await chromium.launchPersistentContext(profile, {
              executablePath: browser,
              chromiumSandbox: true,
              headless: true,
              viewport: null,
              locale: "en-US",
              timezoneId: "UTC",
              colorScheme: "light",
              reducedMotion: "reduce",
              offline: true,
              timeout: 15000,
              args: [
                `--window-size=${width},900`,
                "--disable-background-networking",
              ],
            });
            /** @type {string[]} */
            const blocked = [];
            await context.route("**/*", (r) => {
              if (r.request().url().startsWith("file:")) return r.continue();
              blocked.push(r.request().url());
              return r.abort();
            });
            const page = context.pages()[0] || (await context.newPage());
            page.setDefaultTimeout(5000);
            await page.goto(
              pathToFileURL(path.join(output, "index.html")).href,
            );
            await page.waitForSelector('body[data-ready="true"]');
            await page.evaluate(() => document.fonts.ready);
            const args = cp
              .execFileSync("ps", ["-eo", "args"], { encoding: "utf8" })
              .split("\n")
              .filter((l) => l.includes(profile) && l.includes("chrome"));
            assert.ok(
              args.length &&
                args.every(
                  (l) =>
                    !l.includes("--no-sandbox") &&
                    !l.includes("--disable-setuid-sandbox"),
                ),
              "sandbox disabled",
            );
            const session = await context.newCDPSession(page);
            /** @type {Record<string,import("./console-visual-browser-types").Shot>} */
            const captures = {};
            let metrics;
            for (const scenario of scenarios) {
              await page.evaluate(
                (id) => consoleVisual.select(id),
                scenario.id,
              );
              await page.evaluate(() => document.fonts.ready);
              metrics = await pageChecks(page, scenario);
              await page.evaluate(() => scrollTo(0, 0));
              const cap = await nativeBitmap(page, session, "full");
              const filename = `${scenario.id}-window-${width}-zoom-${percent}.png`;
              captures[scenario.id] = {
                actual: metrics,
                file: filename,
                pixels: cap.pixels,
                capture: cap.capture,
                png_sha256: sha(cap.png),
              };
              if (width === 780 && percent === 200)
                captures[scenario.id].interactions = await interactionChecks(
                  page,
                  session,
                  scenario,
                  output,
                  scenario.id === "fresh",
                );
              if (repeat === 1) {
                fs.writeFileSync(path.join(output, filename), cap.png);
                receipt.sha256[filename] = sha(cap.png);
              } else {
                assert.ok(first, "first repeat required");
                assert.deepEqual(
                  metrics,
                  first.captures[scenario.id].actual,
                  "scenario repeat metrics drift",
                );
                comparePixels(first.captures[scenario.id].pixels, cap.pixels);
                assert.deepEqual(
                  captures[scenario.id].interactions,
                  first.captures[scenario.id].interactions,
                  "interaction repeat drift",
                );
                if (width === 1440 && percent === 100)
                  repeatArtifacts(output, filename, cap.png);
              }
            }
            assert.ok(metrics, "scenario metrics required");
            /** @type {import("./console-visual-browser-types").Case} */
            const row = {
              requested_window_width: width,
              zoom_percent: percent,
              repeat,
              actual: metrics,
              captures,
              browser_version: context.browser()?.version(),
              preferences_sha256: sha(preferences),
              native_preferences: zoomPreferences(percent),
              actual_browser_argv: args[0]
                .split(profile)
                .join("<disposable-profile>"),
              sandbox_disable_flags_absent: true,
            };
            if (width === 640 && percent === 200 && repeat === 1) {
              const scenario = scenarios[0];
              await page.evaluate(
                (id) => consoleVisual.select(id),
                scenario.id,
              );
              const mutant = await page.addStyleTag({
                content:
                  "#reference{width:1px!important;overflow:hidden!important}",
              });
              let rejected = false;
              try {
                await pageChecks(page, scenario);
              } catch (e) {
                if (String(e).includes("horizontal clipping")) rejected = true;
                else throw e;
              } finally {
                await mutant.evaluate((e) => e.remove());
              }
              assert.ok(rejected, "clipping mutant escaped");
              row.clipping_mutant = "rejected";
              const note = page.locator("#scenario-note");
              const noteText = await note.textContent();
              await note.evaluate((e) => {
                e.textContent = "";
              });
              rejected = false;
              try {
                await pageChecks(page, scenario);
              } catch (e) {
                if (String(e).includes("missing expected label"))
                  rejected = true;
                else throw e;
              } finally {
                await note.evaluate((e, text) => {
                  e.textContent = text;
                }, noteText);
              }
              assert.ok(rejected, "removed scenario note mutant escaped");
              row.removed_note_mutant = "rejected";
              const labelMutant = {
                ...scenario,
                expected_visible: [
                  ...scenario.expected_visible,
                  "MISSING_REQUIRED_LABEL_MUTANT",
                ],
              };
              rejected = false;
              try {
                await pageChecks(page, labelMutant);
              } catch (e) {
                if (String(e).includes("missing expected label"))
                  rejected = true;
                else throw e;
              }
              assert.ok(rejected, "label mutant escaped");
              row.label_mutant = "missing-expected-label oracle rejected";
              const hiddenAction = await page
                .locator("[data-authority-action]")
                .first()
                .evaluateHandle((e) => {
                  const placeholder = document.createComment("action-mutation");
                  e.replaceWith(placeholder);
                  return { e, placeholder };
                });
              rejected = false;
              try {
                await pageChecks(page, scenario);
              } catch (e) {
                if (String(e).includes("missing authority action"))
                  rejected = true;
                else throw e;
              } finally {
                await hiddenAction.evaluate(({ e, placeholder }) =>
                  placeholder.replaceWith(e),
                );
                await hiddenAction.dispose();
              }
              assert.ok(rejected, "missing action mutant escaped");
              row.action_mutant = "rejected";
              const reason = page.locator("#control-reason");
              const reasonText = await reason.textContent();
              await reason.evaluate((e) => {
                e.textContent = "";
              });
              rejected = false;
              try {
                await pageChecks(page, scenario);
              } catch (e) {
                if (
                  /missing expected label|visual field|missing reason/.test(
                    String(e),
                  )
                )
                  rejected = true;
                else throw e;
              } finally {
                await reason.evaluate((e, text) => {
                  e.textContent = text;
                }, reasonText);
              }
              assert.ok(rejected, "missing reason mutant escaped");
              row.reason_mutant = "rejected";

              assert.throws(
                () =>
                  comparePixels(captures[scenario.id].pixels, {
                    ...captures[scenario.id].pixels,
                    rgb_sha256: "mutant",
                  }),
                /pixel mutation/,
              );
              row.pixel_mutant = "rejected";
              row.component_assertions = await componentAssertions(
                context,
                output,
              );
            }
            assert.deepEqual(blocked, [], "outbound page request");
            if (repeat === 1) {
              first = row;
              pair[percent] = captures;
            } else {
              assert.ok(first, "first repeat required");
              assert.deepEqual(row.actual, first.actual, "repeat layout drift");
            }
            receipt.cases.push(row);
          } finally {
            try {
              if (context) await context.close();
            } finally {
              context = null;
              fs.rmSync(profile, { recursive: true, force: true });
              receipt.profiles_removed++;
            }
          }
        }
      }
      for (const scenario of scenarios)
        validatePair(
          pair[100][scenario.id].actual,
          pair[200][scenario.id].actual,
        );
    }
    rasterSummary(
      output,
      scenarios.map((s) => `${s.id}-window-1440-zoom-100.png`),
    );
    for (const [p, h] of Object.entries(sources))
      assert.equal(fileHash(path.join(ROOT, p)), h, "source changed");
    assert.deepEqual(inventory(packageRoot), distributions.playwright);
    assert.deepEqual(inventory(coreRoot), distributions.playwright_core);
    assert.deepEqual(inventory(path.dirname(browser)), distributions.browser);
    receipt.status = "passed";
  } catch (e) {
    receipt.status = "failed";
    receipt.failure = String(e);
    throw e;
  } finally {
    process.removeListener("SIGTERM", cancel);
    process.removeListener("SIGINT", cancel);
    for (const name of fs.readdirSync(output))
      if (name !== "evidence.json")
        receipt.sha256[name] = fileHash(path.join(output, name));
    fs.writeFileSync(
      path.join(output, "evidence.json"),
      JSON.stringify(receipt, null, 2) + "\n",
    );
  }
  return receipt;
}
module.exports = {
  zoomPreferences,
  validateNativeZoom,
  validatePair,
  validateBitmap,
  comparePixels,
  componentAssertions,
  pageChecks,
  interactionChecks,
};
if (require.main === module) {
  const args = process.argv.slice(2);
  assert.equal(args.length, 6);
  /** @type {Record<string,string>} */
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    assert.ok(["--browser", "--playwright", "--output"].includes(args[i]));
    options[args[i].slice(2)] = args[i + 1];
  }
  assert.ok(options.browser && options.playwright && options.output);
  qualify({
    browser: options.browser,
    playwright: options.playwright,
    output: options.output,
  })
    .then((r) =>
      console.log(JSON.stringify({ status: r.status, cases: r.cases.length })),
    )
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
}
