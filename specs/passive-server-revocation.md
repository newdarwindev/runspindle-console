# Confirmed passive-view revocation

For [Console #11](https://github.com/newdarwindev/runspindle-console/issues/11)
and its parent [#3](https://github.com/newdarwindev/runspindle-console/issues/3).

A trusted passive adapter can return a one-use
`createServerRevocationHandle(binding, {revoke, readRevocation, verifyReceipt, timeoutMs})`
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
the expired attempt. Failed closure keeps the replacement view blocked.

`verifyReceipt(binding, receipt, {signal})` receives the same deadline signal as
`revoke`. Asynchronous verifiers should pass it to their transport so expiry
cancels pending verification I/O. Late responses cannot clear the expired
attempt. There is no unattended retry or subsequent view admission.

An adapter can supply the optional read-only `readRevocation` port. After a
failed close, a caller can invoke `reconcileViewCleanup()` on the projection
or stream, including after disconnect. The owner queries the original view
and admission IDs through the retained adapter. It clears the fence only
after independently verifying an exact `revoked` receipt within the same
configured deadline used for close. An active view, wrong binding,
unverified receipt, timeout or late reply leaves cleanup unknown.

The owner accepts one readback attempt at a time and aborts a timed-out read.
Adapters receive the abort signal for I/O cleanup. An attempt returns false
if unavailable or unconfirmed. Additional attempts require an explicit
caller and never reissue the revoke request. When the adapter lacks a readback
port, or Console lacks a branded handle, the uncertainty remains fenced.

A fresh authoritative readback path is required to reconcile a timed-out
attempt; without the optional read-only port, the fence remains open.

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

The hung-verifier regression leaves a loopback proof request pending and waits
for the server to observe the connection close. It confirms that cleanup stays
unknown and that a second passive admission is blocked. The regression fails on
base `487a16b2e1bf4d5305bcee551a0aec995d1b3159`, where the socket stays open
until teardown. Reproduce it with the component command above.

Readback also has an independent loopback route and request ledger. The server
revokes the view, drops the close response and denies frame retrieval. The
client still reports unknown while the exact signed readback is pending.
Concurrent calls produce one read and the ledger shows one server revoke.
Other tests cover mismatched admissions, acknowledgment-only or unverified
receipts, and expired readbacks. A deliberate mutation that releases the slot
before verification fails the pending-readback assertion.

See [local evidence](../docs/server-passive-revocation-evidence.json), close
evidence in the same file, and [readback evidence](../docs/server-passive-readback-evidence.json).
This qualifies the component contract with an ephemeral synthetic server.
KasmVNC-specific authentication and routing, live server revocation,
interactive handoff, and end-to-end desktop acceptance remain open.
