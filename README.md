# CONSOLE — TRUTHFUL OBSERVATION, NOT A GREEN STATUS SCREEN

See the work, its identity and what is still unknown.

**Status: Projection, stream, read-only DOM and retained-snapshot candidates; integrated live UI and desktop adapters remain unqualified.**

Normal text describes implemented boundaries; *italic text marks upcoming work or qualification*. Neither is permission to activate services or use live accounts.

## CONSOLE MAKES UNCERTAINTY VISIBLE

**CONSOLE** implements process-local projection and stream coordination around exact task, host, workspace and session identities. Older revisions and late replies cannot overwrite a newly selected target. Stale, offline, simulated and unknown observations remain distinct rather than being flattened into “running” or “done.”

**READ-ONLY PRESENTATION** now includes a DOM surface, task-navigation candidate and a bounded retained-snapshot transport. The [DOM surface](specs/read-only-view.md) renders sanitized projections with inert text and no control calls. The [retained transport](specs/retained-snapshot.md) reads an exact pinned Tether SQLite snapshot through a fresh subprocess; it is not a live event server or authorization service.

KasmVNC provides the selected remote-display route, and Langfuse provides deeper model-trace exploration. **CONSOLE** supplies the identity, freshness and evidence presentation around those tools, not a replacement VNC server or trace backend. [Stream coordination](specs/stream-coordination.md) keeps unresolved subscription cleanup explicit and refuses overlapping admission when cleanup is unknown.

*Upcoming work connects the rendered fleet experience to authenticated producers, actual KasmVNC sessions and verified control transitions. Real-browser layout/accessibility, full navigation and native/live acceptance remain distinct gates. A permitted URL, DOM-double test or local snapshot is not a qualified live dashboard.*

## ENGINEERING MAP

| Responsibility | Contract and evidence |
| --- | --- |
| Identity and freshness | [Projection source](src/projection.js) · [Evidence](docs/IMPLEMENTATION_EVIDENCE.md) |
| Stream cleanup and late replies | [Stream coordination](specs/stream-coordination.md) |
| Read-only visual surface | [DOM contract and limitations](specs/read-only-view.md) |
| Task selection | [Navigation contract](specs/task-navigation.md) |
| Retained observations | [Pinned snapshot transport](specs/retained-snapshot.md) |

## VISUAL STORY AND PRODUCT CONTEXT

[![Conceptual operator observations; not a runtime screenshot](https://newdarwindev.github.io/runspindle_for_bloomberg/gallery/16.webp)](https://newdarwindev.github.io/runspindle_for_bloomberg/assets/Runspindle_Gallery_Index.html#page-16)

**Conceptual illustration, not implementation evidence:** “Operator observations,” gallery page 16. The asset remains hosted by the [Runspindle for Bloomberg source library](https://github.com/newdarwindev/runspindle_for_bloomberg/blob/a109172363736d4312d303e292f8c0d3a857e394/ASSETS.md); it is linked here, not copied or relicensed. The gallery uses fictional businesses and synthetic values. No Bloomberg affiliation, endorsement, live integration or measured savings is implied.

- [Open the exact slide in the 37-page gallery](https://newdarwindev.github.io/runspindle_for_bloomberg/assets/Runspindle_Revised_Gallery.pdf#page=16) · [Original 29-page UI gallery](https://newdarwindev.github.io/runspindle_for_bloomberg/assets/Runspindle-UI-gallery.pdf).
- [Product concept: 16-page brief](https://github.com/newdarwindev/runspindle_for_bloomberg/blob/a109172363736d4312d303e292f8c0d3a857e394/assets/runspindle_bloomberg_product.pdf) · [40 proposed workflow scenarios](https://github.com/newdarwindev/runspindle_for_bloomberg/blob/a109172363736d4312d303e292f8c0d3a857e394/assets/runspindle_bloomberg_workflows.csv).
- [Research proposal: maintained workflows under explicit authority](https://github.com/newdarwindev/runspindle_for_bloomberg/blob/a109172363736d4312d303e292f8c0d3a857e394/assets/runspindle-paper.pdf) · [Full-cost model, not measured savings](https://github.com/newdarwindev/runspindle_for_bloomberg/blob/a109172363736d4312d303e292f8c0d3a857e394/economics/README.md).

These materials explain the product thesis: useful work should leave a checkable record. Their conceptual scenes do not supersede this repository's implementation evidence or acceptance gates.

## DEVELOPMENT AND ACCEPTANCE

This repository is one boundary of [Runspindle](https://github.com/newdarwindev/runspindle). Repository boundaries do not require one microservice each.

- Read [specifications](specs/README.md), [agent guidance](AGENTS.md), [provenance](provenance.json), [status](STATUS.json) and [legal status](LEGAL.md).
- Run `python3 tools/check_scaffold.py` for structural validation only.
- Operational entrypoints and acceptance gates deliberately fail closed until implemented.
- GitHub Actions use isolated **self-hosted local runners only**. No GitHub-hosted fallback. Runner capacity is not established by publishing workflows.
- No credentials, real sessions, messages, datasets, browser profiles or live host inventory belong here.

No old repository is retired by this scaffold. Migration and archival are separate verified gates.

New conceptual documentation is in [docs/product](docs/product/README.md). These HTML pages are conceptual adaptations; browser visual QA and runtime acceptance are not established.

A dependency-free [projection candidate](src/projection.js) now has synthetic component tests.
Run `npm test`, `python3 tools/check_projection_mutations.py` and
`python3 tools/check_scaffold.py` with Node 20+ and Python 3.
See [implementation evidence and remaining gaps](docs/IMPLEMENTATION_EVIDENCE.md).

The [pinned shared fixture subset](docs/SHARED_FIXTURES.md) can be verified and
consumed in isolation with `python3 tools/shared_fixtures.py` and
`python3 -m unittest discover -s tests -v`. This Python conformance lane is separate
from JavaScript runtime mapping and the projection component tests.

## Implemented validation

Run `python3 tools/validate.py` for all implemented structural, language, fixture, artifact and mutation checks in this repository. The same entrypoint runs on trusted `main` and `ci/*` pushes and manual qualification using disposable Strix x64 guests. Logs include the checkout SHA, image/tool identities, command results and applicable artifact checksums. Unimplemented builds and product acceptance remain explicit in `STATUS.json`; blocked acceptance workflows retain their failing conclusions. ARM64 and native macOS qualification remain pending.


Read [the component-specific technical intent](specs/desired-intent.md) for interfaces, privacy boundaries and acceptance obligations.
