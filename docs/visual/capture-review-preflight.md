# Console synthetic capture receipt preflight (#6)

The existing `visual/build.mjs` source and `tools/check_console_visuals.cjs`
native capture lane are the only renderer and capture lane used here. This
standalone reviewer handoff checks whether a candidate receipt is complete
for the exact source and can move to artifact and human visual review. It
does not substitute a second screenshot generator.

From the repository root (Node 20+), use the exact candidate source checkout:

```sh
node test_support/visual-review-preflight.mjs /path/to/capture/evidence.json
node --test test/visual-review-preflight.test.js
```

The preflight is read-only and offline. It fails on a failed/mislabeled
receipt, missing or duplicated width/zoom/repeat, missing scenario, wrong
artifact name or first-pass index, stale manifest source hashes, repeat RGB
digest drift, or incomplete disposable-profile count. It prints all scenario
IDs with candidate capture counts. No temporary data is created by the
preflight. The tests create and remove a private temp fixture and check that a
negative case exits without a success record.

Fixture tests prove receipt validation only. No PNG bytes are independently
read or verified by this preflight; no screenshots, manual keyboard review,
baseline approval, actual product UI, native desktop integration or live
authority are claimed. Existing artifact comparison and visual review gates
remain separate. Keep #6 open where exact native render/review evidence
is still missing.
