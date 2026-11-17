import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { build, publish, ROOT, SOURCES } from "../visual/build.mjs";
import { visualScenarios, referenceState } from "../visual/scenarios.mjs";
import { createProjectionView } from "../src/view.js";
import { ElementDouble } from "./dom-double.js";

test("visual source is deterministic, bounded and explicitly not rendered", () => {
  const a = build(),
    b = build();
  assert.deepEqual(a, b);
  assert.equal(a.manifest.scenarios.length, 36);
  assert.equal(new Set(a.manifest.scenarios.map((s) => s.id)).size, 36);
  assert.equal(a.manifest.actual_ui, "not_run");
  assert.equal(a.manifest.clock, 1000);
  for (const [name, digest] of Object.entries(a.manifest.source_sha256))
    assert.equal(
      digest,
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(ROOT, name)))
        .digest("hex"),
    );
  assert.ok(
    SOURCES.includes("src/view.js") && SOURCES.includes("src/navigation.js"),
  );
  assert.match(a.html, /connect-src 'none'/);
  assert.match(a.html, /frame-src 'none'/);
  assert.match(a.html, /id="reference-footer"/);
  assert.match(a.html, /data-simulated-marker/);
  for (const scenario of a.manifest.scenarios) {
    assert.equal(scenario.expected_actions.length, 2);
    for (const action of scenario.expected_actions) {
      assert.equal(action.disabled, true);
      assert.ok(action.reason.length);
      assert.match(
        a.html,
        new RegExp(
          `id="${action.id}"[^>]* disabled aria-describedby="${action.reason_id}"`,
        ),
      );
    }
  }
});

test("every declared projection expectation matches actual existing DOM renderer", () => {
  const { manifest } = build();
  for (const scenario of visualScenarios) {
    /** @type {{activeElement: ElementDouble | null, createElement: (tag:string) => ElementDouble}} */
    const document = {
      activeElement: null,
      createElement: (tag) => new ElementDouble(tag, document),
    };
    const body = document.createElement("body");
    // Explicit adapter boundary: this minimal double is not browser/layout evidence.
    createProjectionView(
      /** @type {HTMLElement} */ (/** @type {unknown} */ (body)),
      {
        readState: () => referenceState(scenario),
      },
    );
    const expected = manifest.scenarios.find((s) => s.id === scenario.id);
    assert.ok(expected);
    for (const [key, value] of Object.entries(expected.expected_projection))
      assert.equal(
        body.querySelector(`[data-field="${key}"]`).textContent,
        value,
        `${scenario.id}/${key}`,
      );
    assert.equal(
      body.querySelector('[role="status"]').textContent,
      `Status: ${expected.expected_status}`,
    );
  }
});

test("missing timestamp is never fresh and artifact storyboard never rewrites product outcomes", () => {
  for (const scenario of visualScenarios) {
    if (scenario.observedAt === null)
      assert.notEqual(scenario.freshness, "fresh");
  }
  const s = build().manifest.scenarios.find(
    (s) => s.id === "accepted-delivery-unknown",
  );
  assert.ok(s);
  assert.match(s.expected_fields.acceptance, /Accepted exact digest/);
  assert.match(s.expected_projection.acceptance, /Unknown/);
  assert.match(s.expected_projection.delivery, /Unknown/);
  assert.ok(
    visualScenarios.some(
      (s) =>
        s.id === "long-identities" &&
        referenceState(s).identity.task.length > 200,
    ),
  );
});

test("publication is local, refuses overwrite and produces deterministic bytes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "console-visual-source-"));
  try {
    const target = path.join(root, "out");
    publish(target);
    assert.equal(
      fs.readFileSync(path.join(target, "index.html"), "utf8"),
      build().html,
    );
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(target, "manifest.json"), "utf8")),
      build().manifest,
    );
    assert.throws(() => publish(target), /refuse existing/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("slash-separated native-zoom note retains explicit readable wrapping", () => {
  const css = fs.readFileSync(path.join(ROOT, "visual/layout.css"), "utf8");
  assert.match(css, /(?:^|\n)p\s*\{[^}]*overflow-wrap:\s*anywhere\s*;/);
  const scenario = visualScenarios.find((s) => s.id === "duplicate-events");
  assert.ok(scenario);
  assert.match(scenario.note, /Duplicate\/lost\/queued\/exported\/persisted/);
  // Source safeguard only. Real native-200 clipping checks run on Strix.
});
