# Retained reader deadline evidence

Local offline follow-through for Console #9, based on fb7e24d89d0073f7a34d53f541b2fba7211a4af8.

The previous reader rejected only after child `close`; descendants inheriting
stdout/stderr could extend completion beyond the configured deadline after the
leader exited. The reader now rejects without waiting for inherited EOF, records
unknown cleanup, and fences overlapping/replacement allocation. Success still
requires complete validated frames and successful process close.

## Observed checks

- JavaScript suite: 89 passed, zero failures/skips, including four new process
  tests and the deliberately extended-deadline mutant rejection.
- Python suite: 116 passed, zero failures.
- Pinned Prettier 3.6.2, ESLint 9.39.1 and TypeScript 5.9.3 strict checkJs:
  changed JavaScript files passed. No packages were installed.
- `git diff --check`: passed.
- Aggregate `python3 tools/validate.py`: failed, missing Ruff. This remains a
  blocker; focused checks do not establish aggregate hygiene or CI qualification.

Retained-source integration used the existing exact pinned Tether source, not
current main. Synthetic descendants self-terminate after 2.5 seconds. The mutant
harness initially inherited NODE_TEST_CONTEXT and did not run as an independent
child test runner; that harness failure was corrected before the successful suite
above. It now requires the specific elapsed-time assertion failure, not merely a
nonzero child exit.

## Limits

This is a bounded local adapter improvement, not completion of Console #9. Independent
source review found no correctness blocker in bounded stop, abort and the sticky
cleanup fence, and independently reran all four focused process tests. Its first
combined retained-suite attempt had six setup failures because the pinned-source
environment variable was unset; that attempt is not a passing integration receipt.
No live integration,
provider, browser or deployment qualification is claimed. Cleanup unknown stays
sticky even if the owned leader later exits. Closing local pipes is not proof of
process-tree termination; creating a fresh reader is not a cleanup receipt.
No dependency pin, wire authority, permission, infrastructure or service changed.
