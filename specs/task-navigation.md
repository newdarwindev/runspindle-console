# Synthetic task navigation shell

Original partial offline implementation for Console #10/#3. All issues remain open. This is an executable dependency-free DOM shell, not a backend task-discovery service or a qualified browser application.

`createTaskNavigator(root, {catalog, stream, history})` composes the existing stream and read-only projection renderer. Catalog entries have a unique bounded route key, literal label and immutable selected identity. The catalog is limited to 100 entries. It must be trusted, already sanitized synthetic input, not a native discovery result. Canonical invented tasks live alongside the existing fixtures in `fixtures/console-ui/scenarios.js`.

The shell renders native buttons inside a named navigation region. Selection calls only stream.connect; it never calls stream.view or any control API. Repeated selection of the same active task does not add history or subscriptions. While admission is pending a duplicate returns false rather than promising success; established admission returns true. Refused admission stays unknown and can be retried without a duplicate history entry. Updates retain DOM nodes and focus; explicit task/history navigation focuses the selected button. Each transition has a generation fence; late snapshot completions cannot overwrite the current selection. The stream already fences callbacks and snapshots. An additional exact-identity check keeps old stream records out of a newly selected task when connect fails or refuses a transition.

Unknown history entries clear observation data and disconnect the old stream. Adapter errors show fixed messages, not raw exception content. A rejected history push leaves selection unchanged. Callers must provide a synchronous atomic history adapter: a push that performs an effect and then throws cannot be reconciled by this shell. An unavailable selected task can be retried; no autonomous retry is scheduled.

`createBrowserTaskHistory(browser)` adapts actual browser history APIs through an injected Window-like object. It stores only `runspindleConsoleTask` in state and preserves other object fields. It does not pass a URL to pushState, create navigation URLs, or change location. It observes popstate and returns a listener-removal function. Primitive/array history state is rejected rather than overwritten. The synthetic tests exercise this code against a browser double; actual Back/Forward browser behavior remains unqualified.

Call `update()` after stream events or clock changes. There are no automatic timers and no change-notification protocol is invented. `dispose()` removes button/history listeners and owned DOM, fences pending work and disposes the supplied stream; the navigator therefore owns that stream lifecycle. Cleanup errors do not prevent remaining teardown. No server-side cleanup confirmation is inferred from a return value. The history adapter itself and unrelated DOM/history state remain caller-owned.

## Evidence

`npm test` runs the existing suites plus real stream coordination composed with explicit DOM/history doubles. It covers click/selection, duplicate history effects, Back/Forward sequencing, late snapshot replies, exact identity on refused connect, unknown routes, focus retention/restoration, disposal during pending reads, forbidden viewer calls and failed history push/cleanup. Four bounded subprocess mutations remove repeated-selection suppression, ignore refused admission, report premature success during pending admission, or remove the pending subscription-acquisition guard. Independent history-entry counts, rendered-state/result assertions and subscribe-call counts must fail. An unresolved subscription blocks repeated task switches until its late handle confirms synchronous cleanup; the selected task stays unavailable without old data, and a successful cleanup requires explicit retry. The existing unsafe text mutation still fails after extracting the shared DOM double.

These tests are **not actual DOM, keyboard, accessibility or visual acceptance**. Existing Chromium startup is blocked by local IPC restrictions; no browser sandbox is bypassed. The existing real-DOM renderer harness does not yet test this navigation shell. Runtime discovery, shared envelopes, backend integration, real desktop viewing, rendered responsive/zoom/keyboard behavior, durable navigation and live/native acceptance remain not implemented/not run. No control, deployment, service or source-lift permission follows from this code.

## Explicit observation retry

The named `Retry observation` button and `retryObservation()` API request one fresh
observation for the currently selected task without pushing a history entry or
moving focus. This is a manual action, not an automatic retry or runtime adapter.
The button is disabled with no selected task or while admission is loading; the
API independently enforces the same guard. If an acquired subscription reports
offline/error while its snapshot promise is still unresolved, explicit retry can
proceed without waiting for that old read. Call update after stream events to
refresh button availability. Repeated clicks cannot queue work.

Retry first invalidates the current selection generation and disconnects through
the existing stream owner, then uses its normal connect/snapshot path. Unknown
subscription cleanup still refuses admission and is shown as unknown; retry does
not replace the stream or infer cleanup success. Task changes and disposal fence
late retry completions. Ordinary same-task navigation remains deduplicated; use
the explicit retry action after disconnect/error or to request a fresh snapshot.

`node --test test/navigation-retry.test.js` uses real process-local modules with
the existing synthetic DOM/history boundaries. It checks disconnect/error retry,
repeated clicks, unchanged history and selected identity, task-switch races, late
events, failed cleanup, disposal and zero viewer/control effects. A source mutation
that removes forced admission must fail the independent subscription count.
These checks do not qualify native disabled-button, keyboard, browser history,
layout, accessibility, actual runtime transport or remote revocation behavior.
