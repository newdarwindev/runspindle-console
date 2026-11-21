# Restart-safe retained observation fence (partial Console #9)

The application may configure `highwater` on `createRetainedStream` to a separate
local SQLite database initialized explicitly with:

```
python tools/retained_highwater.py /trusted/local/fence.sqlite --initialize
```

Initialization refuses existing files. Normal reads never recreate a missing
fence. Use one fence per configured source database and task/host/workspace
identity. The binding also includes the pinned Tether revision. Paths and Python
interpreter are trusted application configuration, never wire input.

After the existing decoder validates the source result, an actual SQLite
`BEGIN IMMEDIATE` transaction compares the observation with the last accepted
revision and decoded-record digest. Older revisions and changed decoded fields
at the same revision fail closed across fresh consumers. Commit precedes display;
a timeout/cancellation after commit can conservatively advance the fence without
showing the result. It never authorizes execution or makes retained data live.
The source database is not modified. The fence stores hashes and revision, not
labels. Empty labels include the deletion flag in the digest. Nonempty labels
already imply an edit or creation and retain the prior digest format. Older
receipts with an empty label lack the deletion flag. An observation at that
same revision fails closed, and a higher revision can advance the fence.
Comparisons cover fields decoded by the retained-head reader.

A missing, incompatible, malformed or busy fence fails closed. There is no reset,
repair, automatic initialization, background polling or retry. Each transaction
has a 100ms lock wait and its trusted helper is limited to one second. This is a
synchronous local operation and can stall the caller for that bounded interval.
The parent stream lifetime is checked again after persistence. Existing
unconfirmed child cleanup fences remain unchanged.

The local filesystem and interpreter must be trusted. No resistance to malicious
filesystem replacement, deliberate valid database rollback, kernel hangs,
power loss or administrator tampering is claimed. A changed source location or
pin requires explicit reconciliation rather than silently reusing another
binding. Digests are comparisons, not signatures or authentication. Concurrent
viewers share serialized receipt writes, not a globally linearizable display.
Lost/corrupt state requires operator investigation, not automatic reset.

Verification uses synthetic data with real source/fence SQLite stores, actual
fresh Python/Node processes, competing writers, held locks, missing/corrupt files,
symlinks and extra schema objects. An independently read receipt demonstrates
that deliberately removing the rollback guard permits a forbidden regression.
No live runtime, current upstream permissions, native session, desktop adapter,
provider call or production deployment is qualified. Console #9 remains open.

Reproduce with the exact existing Tether pin and locked quality tools:

```
export RUNSPINDLE_RETAINED_TETHER=/path/to/670989839a0fccbcf2014d01609778ae6e4df424
node --test test/retained-highwater.test.js test/retained-stream.test.js
npm test
python -m unittest discover -s tests
python -O -m unittest discover -s tests
python tools/validate.py
```
