# Trusted browser keyboard evidence

Bounded offline increment for Console issue 10, layered on PR 26 source tree
`8a70646099e49b5623f7cac772b416fd82b5c32d`. This is not full issue acceptance.
Production code is unchanged. The catalog, clock, transport and content are
synthetic; DOM focus and keyboard default activation run in actual Chrome.

## Reproduce

Node 24.21.0, Linux x86_64, Google Chrome 157.0.8103.38:

```
RUNSPINDLE_DOM_BROWSER=/usr/bin/google-chrome node tools/check_keyboard_browser.mjs
```

No dependency installation. Uses Node built-in WebSocket and a temporary local
Chrome debugging endpoint, not an existing user browser. Standard browser sandbox,
disposable profile, CSP denying network content and external host resolution denied.
Browser startup, protocol requests and termination have bounded deadlines. Unknown
termination fails the harness and retains its temporary directory instead of
pretending cleanup completed. No persistent services, real accounts or live APIs.

## Observed

- Trusted browser-dispatched Tab reaches task A with `:focus-visible`.
- Enter activates A, next Tab reaches B and Space activates B.
- Repeated Space does not increase subscription count or History length.
- Next Tab reaches observation retry; Shift+Tab returns to B.
- Every recorded keyboard event has `isTrusted === true`.
- Passive-view call spy remains zero; disposal balances subscriptions/closures
  and removes owned DOM. There is no control adapter in this synthetic setup.
- Disconnecting the task click listener fails specifically
  `keyboard_activation_failed`. This is a deliberate negative, not a pass.

The initial driver omitted Enter's character payload and both positive and mutant
failed activation. Correcting the driver payload made the positive pass while the
mutant still fails. Independent review identified a signal-exit cleanup race;
termination observation was corrected and the full browser pair rerun successfully.

## Actual zoom remains blocked

Four Ctrl-plus keyboard attempts did not change browser metrics: DPR 1, viewport
width 780, visual viewport scale 1 before and after. The result explicitly records
`browser_zoom_shortcut_not_qualified`. No CSS zoom, enlarged font, device emulation
or pinch scaling is substituted for real browser zoom. No 200% zoom claim is made.

Existing DOM/history harness: 59 DOM + 13 History assertions passed; unsafe-text,
wrapping and disconnected-history negatives were detected. Existing suites:
89 Node tests and 116 Python tests passed. Python initially had four missing-Tether
setup failures; rerun with the exact existing retained Tether checkout passed,
with SQLite ResourceWarnings. Scaffold, Node syntax and whitespace passed.
Pinned static toolchain and CI were not qualified.

## Input SHA-256

- harness: `fadb5f7d426de4bebb2881b3186f6ae07015f1d4456e2c21bc345d402ef80080`
- navigation.js: `67d69a25438939b139a48fec52392c2e78fe76d304bd0f45bc156659f3706c1e`
- projection.js: `6a612226ad0934cbe2e35a3bc185be443dc9d7040794d05a6e4e8ef130476955`
- view.js: `ae07d27f771631a4d51fc11de76e51b88ed1e29a5d6047144f25ca101d7e2d2e`
- stream.js: `61901f4534d55cf4b9b4a9a9375fb3f6d2987266d0435f9e702ee655a1a65aef`
- canonical scenarios: `ab43faf5d8451a1204fb892303b227e252d6e40b4e914c87bef057e590294ea1`

This is trusted protocol-driven keyboard input, not manual keyboard review,
screen-reader acceptance, visible-focus contrast/occlusion qualification, screenshot
baselines or runtime interoperability. Issue 10 remains incomplete.
