# Bounded retained-head observation: partial Console #9

This is useful read-only adapter functionality, not completion of Console #9.
Actual current authenticated runtime streams, native identity mapping and live
source revocation remain unqualified. No production service, watcher or provider
was activated. The application explicitly calls connect/poll/disconnect; the
adapter does not schedule recurring reads.

## Implementation

- A separately versioned v2 exporter selects latest head and validates its matching
  projection inside one actual SQLite read transaction. v1 exact-revision API and
  wire validation remain strict, including rejection of null/invalid revisions.
- Existing bounded Python child reader and stream coordinator are reused. Each
  read repeats exact source pin/schema/association and configured target checks.
- One read at a time; zero request queue; cumulative call and monotonic lifetime
  bounds survive reconnect. Disposal/revocation/deadline/uncertain cleanup fence
  reuse. A synchronous close never silently confirms an unresolved child.
- Revision jumps remain explicit gaps, not fabricated history. Rollback and changes
  in decoded fields at the same revision reject. Erased/omitted fields (including
  deletion versus already-empty label) are outside this comparison guarantee.
- Missing projection after admission is unavailable, not repaired or skipped.
  Producer persistence followed by explicit reconnect is required.
- Every record stays retained_local, with null observed time, unknown freshness
  and authority, and no view or execution capability. Local revoke is not proof of
  upstream permission revocation. High-water state is process-local, not durable.

## Verification

Source: `9dfa83e76a42352ce91bbcc96c10675e57624937`, tree
`2351d6a19a3e8540d383a6412ed21f6d980da25d`, equivalent to locally tested
`2674551cfaf72c349ddf5adfbc5dfa01cec9a680`.

The 13 new focused tests use actual pinned Tether writes, SQLite reads, ordinary
file-byte hashes, fresh exporter/Node processes and independently observed heads.
A deliberately removed rollback guard fails the behavioral oracle. Cases include
edit/delete, missing projection/recovery, head jumps, wrong identity/schema,
same-revision substitution, overlap, read/lifetime caps, cancellation, fresh
consumer reconnect and strict v1/v2 separation. No power-loss, hostile filesystem,
universal descendant cleanup or current actor authentication is claimed.

Full frozen source: 122 Node tests, 118 Python normal and optimized, and 11 retained
integration tests passed with zero skips. Independent focused review passed 13
cases and approved corrected source. The required aggregate retains its static
failure; detailed result and diagnostic are recorded in the adjacent JSON receipt.
All other declared checks passed. No baseline, prerequisite or gate was weakened.
The tracked source was clean; one untracked symlink supplied the already pinned
local quality tools. The aggregate emits a source-stability entry only on failure;
none was emitted, and source-file hashes separately bind this qualification.

## Reproduce

Provide a clean exact Tether checkout at
`670989839a0fccbcf2014d01609778ae6e4df424` and the locked local quality tools:

```sh
export RUNSPINDLE_RETAINED_TETHER=/path/to/pinned-tether
export MYPYPATH="$RUNSPINDLE_RETAINED_TETHER"
node --test test/retained-stream.test.js test/retained-snapshot.test.js test/retained-process.test.js
npm test
python -O -m unittest discover -s tests
python tools/validate.py
```

Missing producer source or tooling is a blocked/failed check, not a pass. These
local synthetic-store tests do not qualify remote CI, live providers, current
permission services, desktop integration or a deployment. Console #9 remains open.
