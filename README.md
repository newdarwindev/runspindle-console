# runspindle-console

Fleet, session, trace and actual desktop views with truthful freshness.

**Status: process-local projection candidate; integrated UI and desktop adapters are not implemented.**

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
