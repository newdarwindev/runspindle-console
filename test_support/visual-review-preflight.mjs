// Read-only handoff for the #6 synthetic reference. No rendering or approval.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../visual/build.mjs";

const widths = [320, 390, 768, 1440, 640, 780, 1536, 2880];
const zooms = [100, 200];
const repeats = [1, 2];
const hash = /^[a-f0-9]{64}$/;
const caseKey = (width, zoom, repeat) => `${width}/${zoom}/${repeat}`;
const expectedKeys = new Set(
  widths.flatMap((width) =>
    zooms.flatMap((zoom) => repeats.map((repeat) => caseKey(width, zoom, repeat))),
  ),
);

export function preflight(receipt, manifest = build().manifest) {
  assert.equal(receipt.schema, "console.native-visual-reference.v1");
  assert.equal(receipt.status, "passed");
  assert.equal(receipt.baseline_approval, "candidate_not_approved");
  assert.equal(receipt.evidence_class, "synthetic_readonly_browser_reference");
  assert.equal(receipt.live_runtime, "not_qualified");
  assert.equal(receipt.desktop, "SIMULATED");
  assert.equal(receipt.repeat_pixel_tolerance, 0);
  assert.match(receipt.source_commit, /^[a-f0-9]{40}$/);
  for (const [file, digest] of Object.entries(manifest.source_sha256))
    assert.equal(receipt.source_sha256?.[file], digest, `source digest: ${file}`);

  const ids = manifest.scenarios.map(({ id }) => id).sort();
  const rows = new Map();
  for (const row of receipt.cases) {
    const { requested_window_width: w, zoom_percent: z, repeat } = row;
    assert.ok([w, z, repeat].every(Number.isInteger), "capture case values must be integers");
    const key = caseKey(w, z, repeat);
    assert.ok(expectedKeys.has(key), `unexpected capture case ${key}`);
    assert.ok(!rows.has(key), `duplicate capture case ${key}`);
    assert.deepEqual(Object.keys(row.captures).sort(), ids, `scenario inventory ${key}`);
    for (const id of ids) {
      const shot = row.captures[id];
      const name = `${id}-window-${w}-zoom-${z}.png`;
      assert.equal(shot.file, name, `artifact identity ${key}/${id}`);
      assert.match(shot.png_sha256, hash);
      assert.match(shot.pixels.rgb_sha256, hash);
      if (repeat === 1)
        assert.equal(receipt.sha256?.[name], shot.png_sha256, `artifact index ${name}`);
    }
    rows.set(key, row);
  }
  assert.equal(rows.size, expectedKeys.size, "missing capture cases");
  assert.equal(receipt.profiles_removed, rows.size, "profile teardown count");
  for (const w of widths) {
    for (const z of zooms) {
      const a = rows.get(caseKey(w, z, 1)).captures;
      const b = rows.get(caseKey(w, z, 2)).captures;
      for (const id of ids)
        assert.equal(a[id].pixels.rgb_sha256, b[id].pixels.rgb_sha256, `pixel drift ${w}/${z}/${id}`);
    }
  }
  return {
    evidence_class: "synthetic_receipt_preflight_only",
    source_commit: receipt.source_commit,
    capture_candidate: "receipt_complete",
    artifact_bytes_verified: false,
    baseline_review: "not_run",
    actual_ui: "not_run",
    live_runtime: "not_qualified",
    cases: rows.size,
    scenarios: ids.map((id) => ({ id, captures: rows.size })),
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3)
    throw Error("usage: node test_support/visual-review-preflight.mjs CAPTURE_RECEIPT.json");
  console.log(JSON.stringify(preflight(JSON.parse(fs.readFileSync(process.argv[2], "utf8"))), null, 2));
}
