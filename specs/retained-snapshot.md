# Retained local snapshot transport v1

Partial implementation for Console #9 using real retained Tether SQLite records.
This is a bounded local subprocess/read-only transport, not an event server,
watcher, live backend, current authorization service or full Console acceptance.

## Pins and prerequisites

`dependencies/tether-snapshot.json` pins source 670989839a0fccbcf2014d01609778ae6e4df424,
reviewed Tether PR18, merged by 22546d6b414cb298a6ec60433505ef6cf7ca9883. Exact source
and every Tether module hash are checked before import. Dirty tracked files,
untracked/ignored files anywhere in the import root, package/file symlinks and
preloaded Tether modules reject. No fetch/install/substitution fallback exists.
Node starts a fresh isolated Python interpreter with bytecode writes disabled.
The local checkout/configuration/interpreter are trusted application inputs.
This is not a sandbox for hostile interpreters, Git configuration, concurrent
source replacement or compromised operating systems.

The producer is an existing Admission version-1 database with application ID
1413545985 and the exact pinned schema. The reader does not construct Admission,
adopt legacy metadata, write schemas, ingest events, invoke provider callbacks,
or run schema repairs. Read-only SQL validates a consistent transaction containing
heads, revisions, source ownership, delivery digest and sanitized projection.
The schema helper is used only for inspection. Wrong/missing/partial schema and
legacy unversioned stores reject. File and WAL size are capped at 16 MiB each;
SQLite operation count, lock wait and the owning subprocess deadline are bounded.
These limits may reject larger otherwise valid local stores deliberately.

## Source mapping and separate wire contract

The admission row must satisfy the existing root `runspindle.envelope.v1`
`admission_request` mapping: exact top-level/binding/payload fields, ASCII IDs,
canonical JSON, predecessor and digest associations. Root contract source:
`runspindle` commit 3c1968bab54b774ccf0239c4450e599049a14455,
`specs/runtime-envelopes-v1.md` and `contracts/runtime-envelope-v1.json`.
Nothing is presented as an additional message type of that contract. Values
outside JavaScript's positive safe-integer range reject rather than lose precision.

`runspindle.console.retained.v1` is a separate NDJSON snapshot transport. Exactly
three canonical JSON lines are emitted, at most 16 KiB total:

1. begin: version, type, sequence=0, exact identity(task/host/workspace), revision,
   and pinned source commit.
2. snapshot: version, type, sequence=1, same identity/revision, bounded label,
   deleted Boolean, observedAt=null, authority=unknown, connection=unknown.
3. end: version, type, sequence=2.

The exporter buffers the entire successful result before stdout. A failure emits
only a fixed stderr category and exit 2. No partial snapshot is accepted. The Node
client rejects malformed UTF-8, duplicate/noncanonical JSON, extra fields,
wrong pins/identity/revision, missing/trailing frames, bad sequence and excess
size. Frames are not runtime event sequence numbers. Each read requests one exact
current retained head; old revisions after an edit/delete reject. Explicit reads
reopen the database, not an autonomous subscription/retry loop.

Task, host and workspace come from retained admission binding, not labels.
Label comes only from an existing sanitized projection's message. All other
projection content, grant references, normalized digest and raw input are omitted.
Deleted heads emit an empty label; the wire preserves deletion, but the existing
view does not claim a newly implemented deletion-history UI. Native session,
browser, browser lease, trace/span, artifact and view URL are absent. Admission
lease epoch is not a browser lease and is not mapped to one.

## Historical evidence and authority limits

The new `retained_local` projection provenance means a local retained record,
not authenticated current truth or independently qualified live behavior. The
projection explicitly rejects that class with a timestamp, online state,
authority, simulated flag or passive URL. Existing provenance values retain
compatibility; unknown values still reject. Freshness/status stay unknown,
canExecute is false, and there is no view/control adapter.

The local database is a trusted producer store. Retained rows have no independent
cryptographic authenticity seal. Structural and association checks do not detect
arbitrary internally consistent tampering, authenticate the original actor again,
revalidate current permission, or discover unknown secrets. Configured-secret
redaction occurred at producer persistence; revalidation does not invent its
original secret configuration. A valid retained admission is historical only.
Actual integration tests use synthetic authenticated grants and invented inputs.
No real user database is opened. Ordinary file-byte preservation is observed in
tests; no universal hot-journal, hostile-filesystem or power-loss claim is made.

## Consumer integration and cancellation

`createRetainedSnapshotReader` provides the existing projection's readSnapshot
callback, configured with trusted source/database paths and exact revision.
It launches one Python child, closes stdin, discards raw stderr and accepts stdout
only after complete framing and successful process close. Timeout or abort kills
the owned child and rejects after close. Existing projection generation fencing
prevents old completion from populating a newly selected task. This does not add
a second subscription coordinator or claim server-side unsubscribe semantics.

## Reproduce

Prepare a clean exact pinned Tether checkout using existing authorized access.
Set RUNSPINDLE_RETAINED_TETHER to it. Then run:

- `node --test test/retained-snapshot.test.js`
- `python3 tools/validate.py`
- `python3 -O -m unittest discover -s tests -v`

The integration tests fail visibly when the checkout is missing. CI materializes
the exact source with the existing pinned checkout action/read-only permissions,
runs the integration explicitly and passes the path to aggregate validation. No
remote execution/CI qualification is claimed by local tests.

Tests exercise actual producer/exporter/Node processes and independent read-only
SQL/file observations. They cover repeat reads, real edit/delete admissions,
cross-record corruption, future schema, malformed/large counters, source-bytecode
substitution, UTF-8/chunk limits, truncation/reordering, timeout, cancellation,
stale task completion and disabled control. A deliberate source-pin-check removal
must fail a behavioral rejection assertion. Optimized Python exporter output must
match normal output. Source tests are not live provider/native browser evidence.
