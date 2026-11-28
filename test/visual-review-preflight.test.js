import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "../visual/build.mjs";
import { preflight } from "../test_support/visual-review-preflight.mjs";

/** @returns {any} */
function sample() {
  const manifest = build().manifest;
  /** @type {any} */
  const receipt = {
    schema: "console.native-visual-reference.v1",
    status: "passed",
    baseline_approval: "candidate_not_approved",
    evidence_class: "synthetic_readonly_browser_reference",
    live_runtime: "not_qualified",
    desktop: "SIMULATED",
    repeat_pixel_tolerance: 0,
    source_commit: "a".repeat(40),
    source_sha256: { ...manifest.source_sha256 },
    sha256: {},
    profiles_removed: 32,
    cases: [],
  };
  for (const width of [320, 390, 768, 1440, 640, 780, 1536, 2880]) {
    for (const zoom of [100, 200]) {
      for (const repeat of [1, 2]) {
        /** @type {Record<string, any>} */
        const captures = {};
        for (const { id } of manifest.scenarios) {
          const file = `${id}-window-${width}-zoom-${zoom}.png`;
          const png_sha256 = "b".repeat(64);
          captures[id] = {
            file,
            png_sha256,
            pixels: { rgb_sha256: "c".repeat(64) },
          };
          receipt.sha256[file] = png_sha256;
        }
        receipt.cases.push({
          requested_window_width: width,
          zoom_percent: zoom,
          repeat,
          captures,
        });
      }
    }
  }
  return receipt;
}

test("complete fabricated receipt is a deterministic candidate index, not verified evidence", () => {
  const receipt = sample();
  const result = preflight(receipt);
  assert.deepEqual(preflight(receipt), result);
  assert.equal(result.scenarios.length, 36);
  assert.equal(result.cases, 32);
  assert.equal(result.artifact_bytes_verified, false);
  assert.equal(result.baseline_review, "not_run");
  assert.equal(result.actual_ui, "not_run");
  assert.equal(result.live_runtime, "not_qualified");
});

test("failed scope, stale source, missing evidence, and pixel drift cannot pass", () => {
  const receipt = sample();
  const firstSource = Object.keys(receipt.source_sha256)[0];
  /** @type {Array<[(receipt: any) => void, RegExp]>} */
  const mutations = [
    [(r) => (r.baseline_approval = "approved"), /candidate_not_approved/],
    [(r) => (r.source_sha256[firstSource] = "d".repeat(64)), /source digest/],
    [(r) => r.cases.pop(), /missing capture cases/],
    [(r) => r.cases.push(r.cases[0]), /duplicate capture case/],
    [(r) => (r.cases[0].repeat = "1"), /capture case values must be integers/],
    [(r) => delete r.cases[0].captures.unknown, /scenario inventory/],
    [
      (r) => delete r.sha256[r.cases[0].captures.unknown.file],
      /artifact index/,
    ],
    [
      (r) => (r.cases[1].captures.unknown.pixels.rgb_sha256 = "e".repeat(64)),
      /pixel drift/,
    ],
    [(r) => (r.profiles_removed -= 1), /profile teardown/],
  ];
  for (const [mutate, expected] of mutations) {
    const changed = structuredClone(receipt);
    mutate(changed);
    assert.throws(() => preflight(changed), expected);
  }
});

test("offline CLI returns no success output when a receipt omits a case", () => {
  const work = fs.mkdtempSync(
    path.join(os.tmpdir(), "console-review-preflight-"),
  );
  try {
    const input = path.join(work, "capture-receipt.json");
    const receipt = sample();
    const invoke = () =>
      spawnSync(
        process.execPath,
        ["test_support/visual-review-preflight.mjs", input],
        { encoding: "utf8" },
      );
    fs.writeFileSync(input, JSON.stringify(receipt));
    const good = invoke();
    assert.equal(good.status, 0, good.stderr);
    assert.equal(JSON.parse(good.stdout).capture_candidate, "receipt_complete");
    receipt.cases.pop();
    fs.writeFileSync(input, JSON.stringify(receipt));
    const bad = invoke();
    assert.notEqual(bad.status, 0);
    assert.equal(bad.stdout, "");
    assert.match(bad.stderr, /missing capture cases/);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});
