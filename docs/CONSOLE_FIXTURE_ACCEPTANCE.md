# Console #1: synthetic functional acceptance

This audit addresses the synthetic test-harness issue only. It does not qualify
production APIs, actual native sessions, KasmVNC, live authority, a release, or the
paused visual-reference work in PR33. No screenshot is part of this evidence.

## Exact source and boundaries

Implementation checkpoint: `ce4d1202a92df7a2eb414e9187430e00721e6b5f`.
Tree: `ca621ca0d5340e37dca40a33a918a0bd3a6fb806`.
This is byte-equivalent to locally reviewed commit `21372ce0fd16e4b25fffba7c86e0ca0b401f386d`.
The original PR29 fake API suite was extended, not replaced. Existing stream,
projection and navigation behavior remains the foundation. All identities, labels,
frames and backend observations are invented; fake calls are not real control effects.

## Criterion map

| Requirement | Implementation and observed evidence |
|---|---|
| Eight read domains, states, clock | `fake-server.js`, `fixture-console.js`; tasks, pinned hosts, native sessions, browsers, leases, traces, artifacts and delivery receipts render independent source timestamps, revision, evidence class and full selected identity. Empty/loading/error/unsupported/unknown/offline/stale/ready are exercised. |
| Events, ordering, freshness and partial failure | Existing stream/projection suites plus fake and functional fixture tests cover duplicates, reordered revisions, replay, gaps, schema mismatch, missing/future time, reconnect and snapshot races. Fetching never refreshes source time. Older responses cannot preserve expired freshness or overwrite newer records. |
| Simulated passive view | Functional mounted component shows SIMULATED text and image semantics. Separate immutable passive/control ledgers demonstrate passive admission sends no control requests. Unavailable/unauthorized/disconnected and closure failure are exercised. No desktop pixels or KasmVNC compatibility is claimed. |
| Authority and handback | Buttons use exact fake-server observations; backend independently checks target/session/epoch. Pending, denied, human grant, stale epoch, wrong target, failed closure and incomplete handback are exercised. Forged DOM and response labels cannot grant authority. `canExecute` always remains false. |
| Async interaction and navigation | Existing History/navigation/retry suites plus functional tests cover repeated actions, task switches, late reads/control/acquisitions, abort without manual release, remount-safe request identities and unmount. Old delayed completions cannot release a newer wait. |
| Rendered/accessibility and safe content | Shared `fixture-console.assertions.js` executes against actual sandboxed Chromium DOM, including accessible labels/descriptions/status/frame semantics, identity/time/evidence, hostile markup and canary text, stale/unknown states and cross-target fencing. Existing navigation tests remain separate. This is bounded semantic DOM checking, not full accessibility certification or pixel qualification. |
| Actual component versus scaffold | Actual mounted JavaScript UI and injected fake server are tested separately from Python scaffold, static and artifact checks. Missing runtime/desktop interfaces remain unqualified, not inferred from mock success. |

Independent fence-removal mutants prove wrong-target server or UI-admission defects
are observed as forbidden synthetic requests. Review also reproduced and corrected
six real bugs: remount ID collision, abort not settling, foreign records rendering,
expired authority surviving an older reply, duplicate accessible IDs, and old delay
release deleting a successor. Regression tests retain these counterexamples.

## Reproduction

Use Node 24 and Python 3.12 with the repository's locked quality dependencies.
Provide clean retained Tether source at exact commit
`670989839a0fccbcf2014d01609778ae6e4df424`, not a floating main:

```sh
export RUNSPINDLE_RETAINED_TETHER=/path/to/pinned-tether
export MYPYPATH="$RUNSPINDLE_RETAINED_TETHER"
npm test
python -m unittest discover -s tests
python -O -m unittest discover -s tests
python tools/validate.py
```

The shared real-DOM assertion is `assertFixtureConsole(document)` in
`test/fixture-console.assertions.js`; the committed independent DOM receipt and
[runner and receipt](evidence/console-functional-dom-20261117/README.md) record the exact separate browser execution and source inputs. Do not
replace a missing browser with a passing DOM-double result.

## Results and remaining gates

- Independent Node suite: **109 passed, zero skipped**, including 20 focused tests.
- Python: **118 passed normal and optimized, zero skipped**.
- Retained local-store integration: **11 passed** at the exact Tether pin.
- Actual sandboxed Chromium DOM: **67 assertions passed**, zero unexpected
  intercepted requests; synthetic control/passive counts and cleanup are recorded
  in the independent receipt. No screenshots were generated.
- Frozen aggregate: all behavioral, structural, artifact and retained-source
  checks passed; no source-change failure was recorded (the runner only emits
  source-stability entries on failure); **static quality failed** on one unchanged
  `tools/shared_fixtures.py` Ruff formatting diagnostic. Its bytes match base main.
  Existing debt is 47; neither debt baseline nor gate was weakened.
- The frozen aggregate had clean tracked source and one untracked symlink to the existing locked quality tools. Its detailed dirty-worktree metadata is preserved; acceptance binds exact source-file hashes rather than pretending the entire worktree was clean.
- Earlier runs that overlapped source editing are diagnostic only, not acceptance.

This completes the issue's bounded synthetic fixture scope, contingent on final
independent evidence review and verified merge. Real runtime transport, native
sessions, desktop compatibility, visual baselines, production authority and live
acceptance remain separate open gates.
