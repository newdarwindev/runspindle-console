# Actual Chrome navigation label reflow: partial Console #10

Base: merged Console main `dfdaa27cefec03e31bfd1c36300272a221377b6f`,
including PRs #26 and #27. This extends their existing actual-browser keyboard
harness; it does not change stream, History, control or backend behavior.

## Bounded reproduction

On macOS with Google Chrome `157.0.8103.78` and Node `26.13.0`, run:

```sh
TMPDIR=/path/to/a/writable/task-temp \
  RUNSPINDLE_DOM_BROWSER='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  node tools/check_keyboard_browser.mjs
```

The command creates three separate disposable Chrome profiles. Each loads the
existing navigation, projection and stream code with the canonical synthetic
fixture, overriding only task A's catalog label with 256 `L` characters. The
page has a network-denying CSP; Chrome background networking, extensions and
external hostname resolution are disabled. Protocol commands and browser
shutdown are bounded by the existing harness. The projection's passive-open
spy remains zero, and disposal closes its owned subscriptions. No real task,
account, desktop, provider or viewer is accessed.

## Observed before and after

The new real-layout assertion failed **before** the production edit with
`navigation_label_overflow`. The task button's unbroken label exceeded its
320 CSS-pixel container. Adding `max-width: 100%` and
`overflow-wrap: anywhere` to the owned task buttons preserves the full label
without making the navigation scroll wider than its container.

Two subsequent complete Chrome runs had the same observations: at 320 and
390 CSS-pixel container widths, root scroll widths were 320 and 390; the long
button's client and scroll widths were both 316 and 386. The selected task
remained `task-b`, the projection status remained textual as
`Status: unknown`, and keyboard focus remained on button B. Trusted keyboard
Tab/Shift+Tab/Enter/Space and disposal still passed. Disconnecting the click
listener failed `keyboard_activation_failed`; removing the new wrapping failed
specifically `navigation_label_overflow`. The latter is an independent effect
observation, not a DOM-double style check.

## Actual zoom boundary

Actual 200% **browser zoom remains blocked**. The existing harness's Linux
Ctrl-plus attempt and a macOS Command-plus attempt both left DPR, viewport
width and visual viewport scale unchanged. The latter measured DPR 1,
width 756 and scale 1 before and after. The installed stable Chrome did not
load a temporary unpacked zoom extension; [Chrome documents](https://developer.chrome.com/blog/extension-news-june-2025)
that `--load-extension` was removed from Chrome stable in 137. Seeding a disposable
profile's [documented default zoom-level preference](https://chromium.googlesource.com/chromium/src/+/master/chrome/common/pref_names.h)
also left the observed
synthetic page width at 900 CSS pixels. None of these attempts proves a 2×
browser zoom, and no CSS zoom, deviceScaleFactor, text enlargement or pinch
substitutes for it. The reflow result qualifies an actual DOM at narrow
container widths only.

Manual keyboard/assistive technology, painted-focus contrast or occlusion,
approved visual baselines, actual toolbar/shortcut zoom and live runtime
stream integration remain open. Console #10 and its parent stay open.

## Pinned local inputs and checks

- `src/navigation.js`: SHA-256 `d543cddfa6b94078dd03bdc6b5ff0b56d3546e0c50163370f6d2459ab5c55276`
- `tools/check_keyboard_browser.mjs`: SHA-256 `ca42a6e6cf077ce840018db4dbbd42bc2c6edcac3b3686522034fc104c513ce4`
- `src/view.js`: SHA-256 `ae07d27f771631a4d51fc11de76e51b88ed1e29a5d6047144f25ca101d7e2d2e`
- `src/stream.js`: SHA-256 `61901f4534d55cf4b9b4a9a9375fb3f6d2987266d0435f9e702ee655a1a65aef`
- `fixtures/console-ui/scenarios.js`: SHA-256 `ab43faf5d8451a1204fb892303b227e252d6e40b4e914c87bef057e590294ea1`
- `tools/quality-node/package-lock.json`: SHA-256 `8f74da4ed2179fc535f4d8a261d1a46683f3e244ad02362e53336e39b30f48db`
- Retained Tether test source: `670989839a0fccbcf2014d01609778ae6e4df424`

Full offline Node suite: 89 passed; Python 3.14.10 suite: 116 passed normally
and optimized against that Tether pin. Existing Chrome `--dump-dom` aggregate
DOM harness was intermittently blocked on this Mac by a teardown watchdog
exit 2; the CDP keyboard/layout harness above passed repeatedly. Pinned ESLint,
Prettier and strict TypeScript checks passed for both changed JavaScript files.
Pinned static quality, aggregate hygiene and CI outcomes are recorded separately
in the PR.
