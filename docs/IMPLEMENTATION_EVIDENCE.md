# Console projection candidate

Related issues: [F12 #3](https://github.com/newdarwindev/runspindle-console/issues/3)
and [mock suite #1](https://github.com/newdarwindev/runspindle-console/issues/1).
These issues remain open. This is original process-local JavaScript behavior with
synthetic component tests, not a rendered console or desktop integration.

`src/projection.js` exposes a provisional internal API. `select` binds one target,
`merge` validates a version-1 local observation, `refresh` calls an injected read
adapter, and `view` calls only an injected passive-view adapter. No network or
control adapter is supplied by this package. This version number does not establish
an agreed cross-component protocol; root shared-contract review and consumer
conformance remain outstanding.

The target requires task, host and workspace. Native session, browser, lease epoch,
trace/span and exact sha256 artifact digest are optional for fleet-level projections;
a span needs a trace and an epoch needs a browser. When supplied they must match
every accepted update exactly. Changing any target identity requires a new selection.
Unknown identity keys, unsupported observation versions and invalid combinations
reject without replacing accepted state. Snapshot and event sources must already
be authorized and sanitized by trusted backend adapters. Actor strings and the
projected authority state cannot grant capability; `canExecute` is always false.

An observation carries bounded label text, nonnegative safe-integer revision,
observed milliseconds or explicit null, connection status, authority status,
evidence class, simulation flag and optional view URL. Only these selected fields
are retained. Revisions increase monotonically; older timestamps cannot replace
newer known observations. Event gaps remain unknown until a newer complete snapshot.
Missing/future timestamps remain unknown, and freshness is recalculated with the
injected clock. Offline/unsupported states stay explicit. Simulation is persistently
labeled and cannot claim an integration/live evidence class. Non-simulated sources
remain labeled unverified pending adapter qualification.

Task switches abort reads and pending passive admission, clear old data, and close
an active viewer. Generation and request checks reject late replies even when the
adapter ignores abort. Duplicate view admission is suppressed while pending/open.
A late opened view is closed after navigation or stale admission. Read errors are
represented without retaining arbitrary adapter error strings. URLs require an
explicit configured HTTPS origin and no embedded username/password. `escapeText`
escapes HTML metacharacters for a future renderer; it is not evidence that a UI uses
it correctly. Adapters must enforce viewer authorization, trusted origins, response
size/deadlines and cancellation. An ignoring/hung adapter is not forcibly terminated;
this package does not claim bounded external resource or cleanup guarantees.

The projection retains one target and one observation in process memory; text/ID/URL
lengths and integer inputs are bounded. It has no event history, durable store,
transport implementation, secret masker, authenticated observation verification,
view protocol qualification, control requests or execution authority. It neither
restores authority across restart nor claims to revoke server-side viewer sessions.
An adapter close failure is caught; closure acknowledgment is not proven.

## Executed local checks

On 2026-11-13, based on console `8d76a3919b019539aa4201294fef88cf2de645eb`,
Node v26.13.0 and Python 3.9.6:

- `npm test`: 12 tests passed (11 projection tests plus the distinct scaffold readiness test).
- `python3 tools/check_projection_mutations.py`: three deliberately broken variants
  were rejected by the actual projection test suite: duplicate revision acceptance,
  wrong identity acceptance, and treating unknown time as fresh. Each failed with
  Node exit 1; isolated temporary copies were removed.
- `python3 tools/check_scaffold.py`: structural and existing artifact checks passed.
- `python3 tools/acceptance_gate.py console-build`: blocked, exit 78 as intended.

Test data are fixed synthetic identities, `.invalid` viewer origins, synthetic labels
and error canaries. No random source, provider, browser session, credentials or sibling
services are used. The fixture is the `fixture` function and immutable `target` in
`test/projection.test.js`; exact test/source hashes and commands are recorded in
`local-projection-tests.json`. The test harness supplies an injected clock and
in-process transport spies, not an HTTP/event-stream server. Mutation tests run in
bounded Node child processes with a 20-second timeout and temporary directories.
No GitHub Actions execution, rendered keyboard/focus/accessibility test, pinned
upstream integration, recovery or live acceptance result is implied.

## Remaining issue blockers

- **#3/F12:** shared producer/consumer contracts need review; host native-session
  identity/freshness, browser authoritative handoff/lease and actual KasmVNC desktop,
  platform telemetry, core artifact/delivery adapters are absent. No application UI
  exists for keyboard/focus/rendered assertions. Durable behavior is unimplemented.
- **#1 mock suite:** needs those shared projection fixtures and actual UI components
  before rendered/a11y tests or an event-stream integration lane can exercise them.
  Current pure module tests are the reusable starting point, not the full suite.
- **#2/SRC-010:** public provenance only contains a conceptual adaptation. Exact
  selected historical source, linked asset/dependency inventory and private rights
  review are unavailable here. The section/asset disposition and faithful visual
  migration cannot be completed from the public derivative alone. No source imported.

Operational readiness and acceptance gates continue to fail closed. Source migration
remains partial; no legacy archival or deployment follows from these tests.
