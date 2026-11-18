/* global require */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  zoomPreferences,
  validatePair,
  validateBitmap,
} = require("../tools/check_console_visuals.cjs");
const normal = {
  cssZoom: "1",
  visualViewportScale: 1,
  outerWidth: 780,
  innerWidth: 780,
  dpr: 1,
};
const enlarged = { ...normal, innerWidth: 390, dpr: 2 };
test("native preference is partition dictionary, not CSS/device emulation", () => {
  assert.equal(zoomPreferences(100).partition.default_zoom_level.x, 0);
  assert.ok(
    Math.abs(
      zoomPreferences(200).partition.default_zoom_level.x -
        Math.log(2) / Math.log(1.2),
    ) < 1e-12,
  );
  assert.throws(() => zoomPreferences(150));
});
test("actual native metrics qualify", () => validatePair(normal, enlarged));
test("missing native zoom fails even when preference was requested", () =>
  assert.throws(() => validatePair(normal, normal)));
test("CSS zoom is not native browser zoom", () =>
  assert.throws(() => validatePair(normal, { ...enlarged, cssZoom: "2" })));
test("visual viewport emulation is not native browser zoom", () =>
  assert.throws(() =>
    validatePair(normal, { ...enlarged, visualViewportScale: 2 }),
  ));
test("device scale without native viewport change fails", () =>
  assert.throws(() => validatePair(normal, { ...enlarged, innerWidth: 780 })));
test("changing outer window instead of genuine zoom fails", () =>
  assert.throws(() => validatePair(normal, { ...enlarged, outerWidth: 390 })));

test("native bitmap dimensions and visible content qualify", () =>
  validateBitmap(
    { size: [780, 757], color_count_lower_bound: 257 },
    { width: 780, height: 757 },
  ));
test("CSS-sized clipped bitmap fails at native zoom", () =>
  assert.throws(() =>
    validateBitmap(
      { size: [390, 378], color_count_lower_bound: 257 },
      { width: 780, height: 757 },
    ),
  ));
test("missing lower half of full page fails", () =>
  assert.throws(() =>
    validateBitmap(
      { size: [780, 500], color_count_lower_bound: 257 },
      { width: 780, height: 1000 },
    ),
  ));
test("blank focused viewport fails despite valid dimensions", () =>
  assert.throws(() =>
    validateBitmap(
      { size: [780, 757], color_count_lower_bound: 1 },
      { width: 780, height: 757 },
    ),
  ));

test("normalized pixel mismatch is rejected independently of PNG file metadata", () => {
  const { comparePixels } = require("../tools/check_console_visuals.cjs");
  assert.throws(
    () =>
      comparePixels(
        { size: [10, 10], rgb_sha256: "a" },
        { size: [10, 10], rgb_sha256: "b" },
      ),
    /pixel mutation/,
  );
  assert.throws(
    () =>
      comparePixels(
        { size: [10, 10], rgb_sha256: "a" },
        { size: [5, 10], rgb_sha256: "a" },
      ),
    /dimensions/,
  );
});

test("missing or invalid native CDP zoom is rejected", () => {
  const { validateNativeZoom } = require("../tools/check_console_visuals.cjs");
  for (const value of [undefined, null, 0, -1, NaN, Infinity, "2"])
    assert.throws(() => validateNativeZoom(value), /native CDP zoom/);
  assert.equal(validateNativeZoom(2), 2);
});

test("entire outline must fit viewport and modal scrollport", () => {
  const {
    validateFocusOutline,
  } = require("../tools/check_console_visuals.cjs");
  const good = {
    rect: { top: 20, bottom: 60, left: 20, right: 80 },
    bounds: { top: 0, bottom: 100, left: 0, right: 100 },
    outline: "solid",
    width: 3,
    offset: 2,
  };
  validateFocusOutline(good);
  assert.throws(
    () =>
      validateFocusOutline({ ...good, bounds: { ...good.bounds, bottom: 62 } }),
    /clipped/,
  );
  assert.throws(
    () =>
      validateFocusOutline({ ...good, bounds: { ...good.bounds, left: 18 } }),
    /clipped/,
  );
  assert.throws(
    () => validateFocusOutline({ ...good, outline: "none" }),
    /missing/,
  );
});
