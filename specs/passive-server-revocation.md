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
fence in place. Expiry aborts the close request and late responses cannot clear
the expired attempt. There is no unattended retry or subsequent view admission.
A fresh authoritative readback path for reconciling a timed-out attempt remains
open.

The existing void-returning close remains a local cleanup contract. An
unbranded Promise cannot confirm a server-side close. A late successful open
after navigation is revoked once. Task replacement and disconnected
projections share the same unresolved ownership fence.

## Verification

Run `node --test test/server-passive-revocation.test.js` with Node 20 or later.
The loopback test independently observes that the synthetic frame endpoint
still serves before revocation, that the client blocks a second open, and
that the endpoint denies reads after a signed closure receipt. The backend
has no input route. Additional tests exercise a late acquisition, exact
receipt binding, a forged receipt, failed close, and timeout. A deliberate
early-fence-release mutation fails the loopback lifecycle test.

See [local evidence](../docs/server-passive-revocation-evidence.json).
This qualifies the component contract with an ephemeral synthetic server.
KasmVNC-specific authentication and routing, live server revocation,
interactive handoff, and end-to-end desktop acceptance remain open.
