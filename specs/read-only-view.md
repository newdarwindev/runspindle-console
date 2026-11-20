# Read-only projection DOM surface

Partial original implementation for [#10](https://github.com/newdarwindev/runspindle-console/issues/10), [#3](https://github.com/newdarwindev/runspindle-console/issues/3) and synthetic fixtures in #1/#6. No historical source is imported. No issue is closed.

`createProjectionView(root, {readState})` mounts one section in the supplied HTML element. Supply a trusted `createProjection` or `createStreamProjection` state reader. Call `update()` after observations and clock changes; there are no timers, subscriptions or automatic refresh. `dispose()` removes only the owned section, is idempotent and makes subsequent updates return false. The caller owns projection/transport disposal.

The surface renders task/host/workspace/native-session/browser/lease/trace/span/artifact identities, observed Unix milliseconds, revision, freshness, reported evidence and authority. Missing values are unknown. Artifact acceptance and delivery remain independently unknown because this projection does not supply them. Reported evidence is explicitly not independently verified; simulated observations retain an uppercase SIMULATED label. Non-simulated sources remain unqualified.

All observations use textContent. No raw HTML, links, images, frames, viewer admissions, fetch calls or control functions are created/called. A URL in an observation remains inert and is not rendered as a navigation destination. Display text bounds are 4096 characters and identity bounds 256. This renderer is not a secret masker or a wire validator: adapters must supply authorized sanitized projections. It never trusts a supplied canExecute flag.

The stable section has an accessible name, headings, definition lists and a polite atomic status region. Updating does not replace its DOM nodes or move focus. Reader/getter failures clear all previous fields and show unknown without disclosing exception text. There are no interactive controls; this is not a complete task-navigation application.

## Verification and limits

- `npm test`: explicit minimal DOM-double tests exercise projected states, hostile literal text, identity switching, clock staleness, focus-node preservation, no viewer/control effects, disposal and sanitized read failures. A bounded child process changes textContent to innerHTML; the same suite must reject it. These are DOM-double behavior tests, not real-browser evidence.
- `python3 tools/check_projection_dom.py`: runs the same assertions in installed Chromium with its normal sandbox, a disposable profile, restrictive CSP, blocked DNS, no external URLs and no HTTP server. The separate unsafe-text mutation must fail. Missing tools, browser startup failure and timeout return blocked/78, never pass. It does not install anything or disable the browser sandbox. Each browser process is bounded to 25 seconds; temporary files are removed.
- The current cloud execution environment prevents Chromium from creating its local IPC socket. Actual DOM and browser mutation evidence remain **blocked**, not passed. No screenshot or visual/accessibility acceptance is claimed.

`fixtures/console-ui/scenarios.js` is the canonical original synthetic state family for this slice, reusable by #6. No second mock desktop/control implementation is introduced. Keyboard navigation application behavior, Back/Forward, real transport integration, responsive/200%-zoom layout, clipping detection, rendered accessibility, server revocation, native/live acceptance and durability remain unimplemented/not run. The browser harness measures DOM behavior only, even if it later passes.

The [server revocation contract](passive-server-revocation.md) is available
to trusted passive adapters. This read-only DOM renderer still mounts no viewer.
