# Offline projection reflow: partial Console #10

Base: `d1bd9650af564b3a1c726a073ab966b4296d4313`.
The actual read-only DOM panel overflowed horizontally with an unbroken 256-character
identity and 4096-character observation. The new real-layout regression failed
before the fix. Applying `overflow-wrap: anywhere` to the owned panel preserves
complete text while allowing wrapping; no root/global styles or control authority
change. The DOM double only accepts style assignments; it does not simulate layout.

## Reproduction

Use an existing standard-sandbox Chromium/Chrome installation; no install or
sandbox bypass is part of this check. The default remains `chromium`; an explicit
trusted executable can be selected with `RUNSPINDLE_DOM_BROWSER`.

```
RUNSPINDLE_DOM_BROWSER=google-chrome python3 tools/check_projection_dom.py
```

The command uses disposable profiles, offline synthetic content, CSP denying
network resources, disabled background networking and blocked host resolution.
Each browser subprocess has a 25-second bound. Actual layout, unsafe-text mutation
and wrapping-removal mutation run separately. The latter must fail specifically
with `long_text_overflow`, not merely any browser/test failure.

## Observed evidence

- Google Chrome 157.0.8103.38, normal sandbox: 59 DOM assertions passed. Unsafe
  innerHTML mutation failed; wrapping-removal mutation failed the required overflow
  assertion. No browser settings were changed.
- The real layout checks use container widths 320, 390, 768 and 1440 CSS pixels,
  each at 16px and 32px font size. Exact identity/observation contents and focused
  panel remain intact. These are container reflow/text-enlargement checks, not
  browser viewport emulation or browser zoom.
- Node v24.21.0: all 89 tests passed, zero skips, via `node --test test/*.test.js`.
  npm was unavailable; this is the exact package test command run directly.
- Python 3.14.8: all 116 tests passed after materializing exact existing Tether pin
  `670989839a0fccbcf2014d01609778ae6e4df424`. An initial Python run had four setup
  failures because this source was absent; it is not counted as a passing run.
- Scaffold and `git diff --check` passed.
- Pinned static tools (Ruff, Node lint/type/formatter toolchain) unavailable on
  this executor; aggregate hygiene and remote CI are not qualified.

## Limits

No screenshots, approved visual baselines, contrast audit, manual keyboard review,
real browser Back/Forward qualification or 200% browser zoom acceptance is claimed.
This is partial #10 progress, not full accessibility conformance or issue closure.
No live backend/provider/desktop integration, installation, service, credentials,
permissions, dependency pins, accepted/delivered semantics or deployment changed.

## Reproduction input SHA-256

- `src/view.js`: `ae07d27f771631a4d51fc11de76e51b88ed1e29a5d6047144f25ca101d7e2d2e`
- `test/dom-double.js`: `b6af807fd66b585aed1fff98e724a17eb217ce62c130cb50dbe1d96bd5aab507`
- `test/view.assertions.js`: `00215115e677d3ae8383ffff0c2cc8bd12528df440151c0420836098e3d5911c`
- `tools/check_projection_dom.py`: `cf94fe07b0d4f1fed8b15d647320e6c246acf430bc41adf85453adb3d97771aa`
