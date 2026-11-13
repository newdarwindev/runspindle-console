# Pinned console fixture subset

This partially addresses [console mock-suite #1](https://github.com/newdarwindev/runspindle-console/issues/1)
and [composition fixture kit #1](https://github.com/newdarwindev/runspindle/issues/1).
Both remain open. The bundle is provisional synthetic test material, not a runtime
wire protocol, authenticated observation adapter or integration acceptance.

`fixtures/shared-v1` is an unchanged console export from composition commit
`e8cd5779968fede213443db13a591c992cd0e183`. It contains native, browser,
artifact and telemetry observation golden fixtures plus all 12 applicable negative
vectors. The separately reviewed `fixtures/shared-v1.pin.json` records that source
commit, schema/component, full origin-manifest digest and subset-manifest digest.
The subset manifest binds every exported file. Original synthetic fixture provenance
is retained from the composition source; no selected historical material was copied.

Run locally with Python 3.9+ (no installation, sibling checkout or network needed):

```sh
python3 tools/shared_fixtures.py
python3 -m unittest discover -s tests -v
npm test
python3 tools/check_projection_mutations.py
python3 tools/check_scaffold.py
```

`tools/shared_fixtures.py` checks the separately reviewed pin, exact inventory and
every file hash before compiling/executing the exact verified source-byte snapshot.
It never imports a vendored bytecode cache; an extra cache directory is rejected. Calling
`fixtures/shared-v1/fixturekit.py` directly bypasses this external-pin check and is
not the consumer invocation. Symlinks, unexpected files, corrupt bytes and a
self-rehashed altered manifest are rejected. The pin is trusted checked-in review
input; replacing both pin and bundle requires review, not automatic refresh.

Seven Python consumer tests run all four positive fixture kinds against separate
synthetic expected identities/receipts and all 12 negative mutations against the
unchanged positive oracle, asserting exact declared error codes. They deny socket
construction, connection and DNS and assert zero calls. Corruption tests use temporary directories
and remove them on exit; they prove corrupt validator bytes are rejected before
execution and an internally consistent altered manifest cannot replace the reviewed
pin. A matching executable bytecode cache is rejected without running it. A source
file deliberately changed after hash verification cannot replace the byte snapshot
that is compiled; the subsequent bundle recheck detects changed files. No services or child processes are started by the Python fixture-consumer tests.

The JavaScript projection tests remain a separate synthetic component lane. The
Python consumer uses the shared validator; no JavaScript validator or runtime
mapping from these provisional envelopes has been implemented or qualified.
This change does not establish producer/consumer parity with actual host/browser/
artifact/telemetry adapters, nor rendered accessibility, durable recovery, upstream
compatibility, live acceptance or deployment. Required product gates stay blocked.

To upgrade later, inspect old/new contracts, vectors and exact export hash diff,
review producer/consumer semantics, and explicitly replace the separate pin. Never
resolve a floating branch at test time. The original one-time export command was
`python3 fixtures/v1/fixturekit.py export console NEW_DIRECTORY` from the pinned
composition source. Local results/tool versions and input hashes are in
`docs/local-shared-fixture-tests.json`. Existing isolated self-hosted workflows and
fail-closed operational entrypoints are unchanged.
