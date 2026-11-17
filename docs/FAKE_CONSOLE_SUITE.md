# Local synthetic Console functional suite

Console #1 is an offline test-fixture contract, not live integration or a screenshot
campaign. This extends the original PR #29 fake API suite, rather than introducing
another network/server product. The production defaults remain read-only.

## Reproduction

Run `RUNSPINDLE_RETAINED_TETHER=/path/to/pinned/runspindle-tether npm test` from
this repository root. Node 20+ and Python 3.11+ are required. The Tether checkout
must match `dependencies/tether-snapshot.json`; missing/mismatched prerequisites
fail closed. Use the pinned tools in `requirements-quality.txt` and
`tools/quality-node/package-lock.json` for `python3 tools/validate.py`, with the
retained checkout also on `MYPYPATH`. No test installs software or calls providers.

The focused new functional tests are:

```
node --test test/fake-server.test.js test/fixture-console.test.js test/fixture-console-mutation.test.js
```

`test/fixture-console.assertions.js` exports `assertFixtureConsole(document)` for
an independently launched, sandboxed, network-denied **actual DOM** browser
harness. It needs the source modules listed below and no screenshots. DOM-double
results must not be relabeled actual browser/accessibility evidence. Exact-source
browser execution is recorded separately; this document alone does not claim it
ran. Actual KasmVNC compatibility remains a separate pinned gate.

## Source and scenario manifest

| Source | Scope | Evidence boundary |
| --- | --- | --- |
| `fixtures/console-ui/scenarios.js` | Invented task/host IDs, hostile text, labeled simulated/unavailable/unauthorized/disconnected viewers | Synthetic inputs |
| `fixtures/console-ui/fake-server.js` | Eight bounded read domains, controllable source clock, immutable source snapshots, replayable event stream, exact target/session/epoch, passive resources and synthetic authority decisions | Process-local test backend, no socket |
| `src/projection.js`, `src/stream.js` | Revision/gap/freshness/schema fencing and shared passive-resource ownership | Existing component behavior reused |
| `src/view.js`, `src/navigation.js` | Read-only projection, task history, cancellation and focus | Existing components reused, not replaced |
| `src/fixture-console.js` | Mounted functional facet DOM, source timestamps/evidence/identity, passive frame, synthetic takeover/handback buttons and late-response fencing | Explicit local fixture UI only |
| `test/fake-server.test.js` | Facet APIs, source age, partial failure, replay/gap, missing timestamp, passive-only admission | Deterministic component tests |
| `test/fixture-console.test.js` | Full facet state set, target/session changes, immutable records, canary allowlist, forged DOM/receipt, pending/denied/granted/stale authority, incomplete handback, viewer failure, late reads/control and unmount | DOM-double component tests, not browser qualification |
| `test/fixture-console-mutation.test.js` | Deliberately removed exact-target/UI admission fences and independently observed forbidden requests; network fallback trap | Negative component evidence |
| `test/fixture-console.assertions.js` | Actual DOM semantic names/status/descriptions, safe text/URL absence, eight domain identities, source freshness, passive-only lifecycle and control-state rendering | Browser-only assertions, execution receipt separate |
| Existing projection/stream/navigation/passive lifecycle/mutation tests | Delayed/replayed/out-of-order event merges, snapshot reconnect, cancellation, history, repeat input and cross-task races | Existing test lanes retained |

The seed is recorded (default 1), but no randomness is consumed. Virtual source
clock normally begins at 1000. Facet `observedAt` changes only when a source fixture
is updated, never because a client reads it. Null/future timestamps are unknown;
old observations are stale. Empty/loading/error/offline/unsupported are distinct.
Reads capture immutable revisions before an explicitly released delay. A later
response cannot overwrite a newer client generation or another task's records.
Cancellation settles held reads/passive/control promises through abort listeners
without requiring a test to release the delayed backend. Retained authority and
facet freshness are recomputed; an older fresh reply cannot preserve an expired
higher-revision permission. Simultaneous mounts have distinct description IDs.

Eight domains are tasks, pinned hosts, native sessions, browsers, leases, traces,
artifacts and delivery receipts. Records carry full selected correlation identity;
artifact digests must have `sha256:` plus 64 hex characters. Unknown delivery
remains unknown. Fixture-confirmed receipt labels are explicitly synthetic.
Facet responses require exact top-level schema and bound identity, and every rendered item must match the same identity and allowlisted shape. Malformed or foreign responses render unknown without their contents. Unknown source record fields are omitted; configured synthetic canaries are redacted in
labels and rejected in immutable identifiers. Arbitrary secret discovery is not
claimed. The view uses `textContent`, not markup or navigable provider URLs.

## Synthetic authority and passive-view boundary

`decide()` is a **test driver**, not a UI or production approval endpoint. It sets
the fake server's authoritative observation to pending, denied, human, agent,
unknown or handback_pending. The UI never decides a grant from a click, timeout,
DOM attribute, control response or its own display state. It refreshes the exact
server identity/epoch and source observation. The server validates every request,
keeps an immutable bounded ledger and allocates deterministic server-scoped request IDs that survive UI remounts. It deduplicates exact request IDs; conflicting
ID reuse rejects. A granted label enables only a synthetic handback request.
There is no execution/control-input channel, and `canExecute` is always false.

Passive admission uses only the existing projection adapter's exact passive
request. It has a separately observed request ledger and resource count. Frames
are invented text labeled SIMULATED, never captured desktop content. Unavailable,
unauthorized and disconnected fixtures reject admission. Close failure remains
unknown and blocks handback/new views, including after task changes. Shared stream
ownership survives selection; late acquisitions are closed or remain explicitly
unconfirmed rather than being forgotten by replacing a controller.

## Isolation and limits

Each test creates/disposes its own server and DOM component. Capacity bounds apply
to domain records, subscriptions, delayed requests, control/passive ledgers and
registered task bindings. There is no provider credential, HTTP fallback, standing
service, browser sandbox bypass or real input/control endpoint. Test-created source
mutants live in disposable directories and are removed in `finally` blocks.
The actual browser lane must independently deny requests and clean up its process
and profile. It must not silently count a missing browser as passed.

No screenshots, screenshot baselines or paused PR #33 assets are imported by this
work. No live KasmVNC/native/browser integration, durable UI state, production
authority backend or deployment is qualified by these fixtures. Scaffold/status
checks remain distinct from actual component and browser assertions.
