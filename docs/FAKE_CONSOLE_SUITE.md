# Local fake Console suite

Run `RUNSPINDLE_RETAINED_TETHER=/path/to/pinned/runspindle-tether npm test` from
this repository's root. Node 20 or newer and Python 3.11 or newer are required.
The Tether checkout must match `dependencies/tether-snapshot.json`; the retained
snapshot tests fail closed without it. Provision the exact quality tools in
`requirements-quality.txt` and `tools/quality-node/package-lock.json`, then run
`python3 tools/validate.py` with that checkout on `RUNSPINDLE_RETAINED_TETHER`
and `MYPYPATH`. No test installs dependencies or contacts a provider.

## Fixture manifest

| Fixture | Scenario | Evidence |
| --- | --- | --- |
| `fixtures/console-ui/scenarios.js` | Invented task and host, hostile text, simulated viewer URL | Synthetic component |
| `fixtures/console-ui/fake-server.js` | Eight process-local read domains, partial failure, controllable clock, replayable events, passive admission | Synthetic component |
| `test/fake-server.test.js` | Domain reads, clock, duplicate/order/gap, simulated passive view and missing timestamp | Synthetic component |
| `test/stream.test.js`, `test/projection.test.js` | Snapshot merge, schema mismatch, age and identity fencing | Synthetic component |
| `test/view.test.js`, `test/navigation.test.js` | DOM double rendering and navigation races | Synthetic component |

The fake's `seed` is recorded but no randomness is consumed. Each test creates and
disposes its own server. It opens no socket and has no network fallback. The fake
control endpoint always denies; passive view tests assert zero control calls.

`src/view.js` remains a read-only surface. It cannot render the eight domains as
independent records or exercise takeover buttons, handback, viewer closure,
artifact acceptance or delivery receipts. Those issue criteria are **blocked**
until corresponding UI and backend authority components exist. A fake green test
does not qualify KasmVNC, a real browser, provider integration or live acceptance.
