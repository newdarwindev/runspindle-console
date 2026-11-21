# Confirmed passive-view revocation

For [Console #11](https://github.com/newdarwindev/runspindle-console/issues/11)
and its parent [#3](https://github.com/newdarwindev/runspindle-console/issues/3).

A trusted passive adapter can return a one-use
`createServerRevocationHandle(binding, {revoke, verifyReceipt, timeoutMs})`
from `openPassive`. The binding names the exact server view and its admission
ID. The adapter still owns admission, target authorization, and transport
configuration. The handle exposes no keyboard, mouse, or takeover method.

Navigation, disposal, invalidation or a changed reported authority requests
revocation of the old view. The shared projection owner keeps the slot
reserved and reports `viewCleanup: "unknown"` during the close. A reply clears
that fence only if the adapter independently verifies a `revoked` receipt for
both exact IDs before the deadline. A request acknowledgment, receipt for a
different admission, rejected authenticator, error or timeout leaves the
fence in place. `verifyReceipt(binding, receipt, {signal})` receives the same
deadline signal as `revoke`. Asynchronous verifiers should pass it to their
transport so expiry cancels pending verification I/O. Late responses cannot
clear the expired attempt. There is no unattended retry or subsequent view
admission.
A fresh authoritative readback path for reconciling a timed-out attempt remains
open.

The existing void-returning close remains a local cleanup contract. An
unbranded Promise cannot confirm a server-side close. A late successful open
after navigation is revoked once. Task replacement and disconnected
projections share the same unresolved ownership fence.

Passive admission has a five-second deadline by default. A trusted adapter can
set `viewOpenTimeoutMs` from 1 to 30,000 milliseconds. On expiry Console aborts
the open request and reports the view as unavailable. The shared owner keeps
the slot reserved because abort does not establish that the server allocated
nothing. A late handle is closed once. A server-backed handle clears the
fence only after the same exact, verified revocation receipt used for other
closures.

## Verification

Run `node --test test/server-passive-revocation.test.js` with Node 20 or later.
The loopback test independently observes that the synthetic frame endpoint
still serves before revocation, that the client blocks a second open, and
that the endpoint denies reads after a signed closure receipt. The backend
has no input route. Additional tests exercise a late acquisition, exact
receipt binding, a forged receipt, failed close, and timeout. A deliberate
early-fence-release mutation fails the loopback lifecycle test.

The hung-verifier regression leaves a loopback proof request pending and waits
for the server to observe the connection close. It confirms that cleanup stays
unknown and that a second passive admission is blocked. The regression fails on
base `487a16b2e1bf4d5305bcee551a0aec995d1b3159`, where the socket stays open
until teardown. Reproduce it with the component command above.

See [local evidence](../docs/server-passive-revocation-evidence.json).
This qualifies the component contract with an ephemeral synthetic server.
KasmVNC-specific authentication and routing, live server revocation,
interactive handoff, and end-to-end desktop acceptance remain open.
