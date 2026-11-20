# Observation workspace: a narrow upstream-reuse slice

This is an executable **synthetic, read-only** UI, not a live backend or control
client. It composes the unchanged `src/view.js` projection renderer with React
and Radix Dialog. The existing projection owns identity, freshness and authority
presentation. The dialog can inspect an evidence boundary, never approve, take
control, send, retry or connect to a desktop.

## Selection and scope

| Candidate | Decision | Reason |
|---|---|---|
| React 19.3.1 | Use for a small shell | Root ownership and explicit mount/update/dispose around existing DOM; no domain rewrite |
| Radix Dialog 1.3.1 | Use | Upstream modal semantics, focus trapping, Escape and focus return replace bespoke dialog behavior |
| TanStack Query | Defer | No query transport exists here; a new cache could hide observation age or change unknown/retry behavior without benefit |
| Whole-UI rewrite | Reject | Replacing tested identity and stale/out-of-order behavior would enlarge the risk unnecessarily |

Primary upstream references: [React incremental roots](https://react.dev/reference/react-dom/client/createRoot),
[Radix Dialog](https://www.radix-ui.com/primitives/docs/components/dialog),
[TanStack Query defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults).
React/Radix are MIT-licensed; packages retain their own LICENSE files. See
`THIRD_PARTY.md`. No upstream source is pasted into the domain modules.

## Reproduce

```
npm --prefix ui ci --ignore-scripts --no-audit --no-fund
node --test ui/shell.test.mjs
node ui/build.mjs /absolute/new/output
node ui/check-task-browser.cjs /absolute/new/output /absolute/chrome/binary
node ui/check-browser.cjs /absolute/new/output /absolute/new/evidence /absolute/playwright/package /absolute/chrome/binary
```

Open `index.html` and follow **Browse synthetic tasks** to use the Task
workspace. It uses the canonical Console catalog, stream projection and
browser History adapter. The task check measures native zoom, identity and
focus through Back and Forward, literal text rendering, and reflow across
desktop, tablet and mobile widths. It also requires a deliberate clipping
mutation to fail. See [task workspace evidence](../docs/browser-task-workspace-evidence.md).

Browser execution requires an already-qualified sandbox-capable Chrome, Pillow,
Playwright 1.58.2 and its video encoder. No browser download, sandbox disable,
network repair or fleet registration is performed. Only local generated files
are loaded; CSP forbids connections and the context is offline. No private
records or credentials enter the fixtures or screenshots.

The matrix covers fresh/loading/stale/offline/unknown-effect/approval-required/
takeover-pending/error, desktop and narrow native windows at real100%/200% zoom,
and separate390CSS-pixel mobile emulation. Native Chrome's minimum window is500px;
we report measured dimensions, never call a500px window390px. Native zoom is
validated with DPR and CSS-viewport ratios. CDP DIP-aware PNG capture avoids
Playwright's native-zoom screenshot truncation. Repeated state navigation must
produce identical pixels and identical domain text. Dialog Tab trapping,
Escape/Cancel/Close focus restoration, no horizontal overflow and console/network
errors are checked. Palette AA contrast tests cover the explicit text colors,
not a claim of complete screen-reader/accessibility audit.

## Baselines and CI boundary

New screenshots/videos are **candidates pending independent visual review**.
The harness never approves or updates a baseline automatically. An optional
fifth argument names an independently reviewed PNG baseline directory; exact
pixel differences are saved and fail the run. Source/bundle/tool hashes accompany
captures. A different browser/font/environment may require a separately reviewed
baseline, not silently increased tolerance.

`console-visual-candidate.yml` is manual, local-isolated-only and retains synthetic
screenshots/video for review. It requires an offline npm input cache, installed
sandboxed Chrome, Pillow and Playwright video encoder in the runner image. Those
fleet prerequisites and actual GitHub execution remain unqualified. No dispatch
is performed by this source change. Existing acceptance-blocked product gates
remain blocked. Passing this lane is not deployed integration or backend authority.
