# Product design narrative

Start with [vision.html](vision.html). These three standalone pages are conceptual
adaptations, not a migrated application or a live system.

Console now owns the canonical SRC-010 vision page. Edit `vision.html` directly;
its inline CSS and system fonts require no compiler or rendering assets. The
composition repository keeps a byte-identical copy at `docs/marketing/vision.html`
and the same SRC-010 notice, disposition map and validation record. Its legacy
marketing renderer must not overwrite the canonical vision page. Other product
pages remain copies of the composition repository's marketing renderer.

Run `python3 tools/check_vision.py` for static structure, navigation, privacy and
content-contract checks. To make an exact local bundle without dependencies, run
`python3 tools/check_vision.py --output /tmp/runspindle-vision-build`. Open that
bundle's `vision.html` in an authorized browser for the visual checks described in
[SRC-010-validation.md](SRC-010-validation.md). A successful copy or checker is not
a visual review. [artifacts.json](artifacts.json) records the resulting hashes.

The complete selected-page scope and exclusions are in
[SRC-010-lift.json](SRC-010-lift.json). Required visual acceptance remains blocked;
overall migration remains partial. Other source lifts and runtime qualification
are unchanged. Retain [source notices](THIRD_PARTY_NOTICES.md) and both MIT notices.

## Technical grounding for future presentations

Use [desired intent](../../specs/desired-intent.md) when revising conceptual
material. Keep planned capabilities separate from measured outcomes and
implemented components. This page adds no execution or release authority.
