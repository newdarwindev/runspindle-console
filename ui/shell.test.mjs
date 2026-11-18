import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ObservationShell } from "./shell.mjs";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

test("generic shell is read-only and creates no control action", () => {
  const html = renderToStaticMarkup(
    React.createElement(ObservationShell, { state: null }),
  );
  assert.match(html, /SIMULATED/);
  assert.match(html, /No live backend/);
  assert.match(html, /Inspect evidence boundary/);
  assert.doesNotMatch(
    html,
    /<form|href=|onclick=|Request control|Approve execution/,
  );
});
test("shell delegates domain rendering without cloning authority decisions", () => {
  const source = fs.readFileSync(
    fileURLToPath(new URL("./shell.mjs", import.meta.url)),
    "utf8",
  );
  assert.match(source, /createProjectionView/);
  assert.match(source, /view.current\?\.dispose/);
  assert.doesNotMatch(
    source,
    /fetch\(|XMLHttpRequest|WebSocket|innerHTML|authority ===|leaseEpoch/,
  );
});
test("palette readable text contrast exceeds WCAG AA", () => {
  /** @param {string} hex */
  const luminance = (hex) =>
    (hex.match(/[a-f0-9]{2}/gi) ?? [])
      .map((x) => parseInt(x, 16) / 255)
      .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
      .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  for (const [fg, bg] of [
    ["142b3b", "ffffff"],
    ["375768", "f2f5f6"],
    ["142b3b", "e8f0f6"],
  ]) {
    assert((luminance(bg) + 0.05) / (luminance(fg) + 0.05) >= 4.5);
  }
});
