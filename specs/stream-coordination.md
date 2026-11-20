# Bounded process-local stream coordination

`createStreamProjection` in `src/stream.js` reuses the existing provisional
projection model. This is an original partial implementation for issues #1/#3
and the bounded subscription-acquisition lifecycle in #9, not a runtime wire
mapping or actual event-stream server. Issue #9 remains open: authenticated
transport and shared runtime mapping still depend on root #43 and Tether #8/#10.
Issues #10–11 retain their real transport, sanitization and authority prerequisites.
No native desktop, durable store, credentials or control API is added here.

## Adapter contract

Supply `clock`, `readSnapshot`, and `subscribe(identity, callbacks)`. The clock
and snapshot format are the existing projection contract. Subscribe installs
`onEvent`, `onDisconnect`, and `onError` callbacks before resolving its handle.
Its `signal` is aborted when navigation, overflow, disposal or disconnection
invalidates that subscription. Adapters are trusted injected code, not callbacks
received from remote payloads. Handles must provide a synchronous `close()` that
returns `undefined` only after unsubscribing. No promises/thenables count as a
confirmed unsubscribe. Missing handles, rejected subscription attempts and failed
unsubscribe leave cleanup unknown and block further subscriptions on this object.
An owner must reconcile the external adapter separately; constructing a new object
does not establish cleanup of an old one.

Connect deduplicates overlapping calls for the same complete identity, including
while acquisition is pending. Switching task/session or disconnecting closes the
old projection and aborts its subscription signal. Abort is not proof that an
unresolved subscribe call did not allocate. One acquisition slot remains occupied
until that call yields a valid handle; a late handle must synchronously confirm
unsubscribe before the slot can be reused. During this invalidated pending state,
`status` and `subscriptionCleanup` are `unknown`, and all connect calls return
false without invoking subscribe again. There is no waiting queue or remembered
next target. Old callbacks and snapshots cannot repopulate the projection.

A successfully closed late handle releases the slot but does not reconnect.
An explicit subsequent `connect()` may subscribe and obtain a new snapshot.
Missing/malformed handles, rejection, thrown close and asynchronous/unconfirmed
close leave cleanup unknown permanently on this object. Repeated disconnect or
dispose never close the same handle twice; disposal never allows reconnect.
The synthetic navigator renders a refused newly selected task as unavailable,
without relabeling the previous stream identity or observation.

For an acquired handle, synchronous teardown also holds admission closed across
abort listeners, projection/passive cleanup and subscription close. Reentrant
connect calls return false, report cleanup unknown during teardown, and are not
queued. A caller-initiated replacement may acquire only after teardown returns
with confirmed subscription cleanup and the object is still undisposed. Disposal
inside a teardown callback also prevents the outer replacement from subscribing.
This preserves the existing passive-view
revocation limitation; it does not add a server acknowledgment.

## Passive-view resource ownership

The stream's task projections share one private passive owner through
`createProjectionFactory`. An unresolved passive open keeps its slot after abort,
task replacement, source revocation or disconnect. A valid late handle must close
synchronously before another explicit `view()` may invoke the adapter. Rejected or
malformed opens and throwing/non-void closes leave sticky uncertainty. A returned
promise is observed to avoid an unhandled rejection, but even successful settlement
is not a cleanup receipt under this synchronous contract. Each acquired handle is
closed at most once; no retry or automatic replacement is scheduled.

`viewCleanup` is `unknown` during synchronous teardown, after an invalidated pending
open, and after unconfirmed cleanup. Otherwise it is `no_unconfirmed_close`, which
means no unresolved local cleanup obligation, not that a viewer is absent or that
server revocation was verified. This field is independent from `subscriptionCleanup`,
observation `status`, and freshness. Read-only observation may continue for another
task while passive admission stays blocked. Disconnect/dispose retain the shared
cleanup state rather than returning a stale projection copy. `canExecute` is false.

Standalone `createProjection` owns one scope; an explicit factory groups projections
using one adapter. Separate stream/factory objects do not provide a global or durable
resource registry. Constructing another object never establishes cleanup of an old
one. A real adapter remains responsible for bounded acquisition, cancellation and
server-side revocation. No real desktop or asynchronous cleanup compatibility is
established by synchronous synthetic handles.

## Observation bounds and transitions

Subscribe precedes snapshot acquisition. Events received meanwhile are validated
through the existing projection, copied to its known bounded fields and buffered.
No arbitrary adapter object graph or additional fields are retained. `maxBuffered`
is 1–1024 (default 64). Overflow or malformed/wrong-identity events terminate the
subscription and show unknown. Snapshot completion precedes buffered event replay;
duplicates and older observations never replace newer ones. Sequence gaps remain
unknown until explicit resubscription and a complete snapshot. Freshness still
uses observation time and the injected clock, not arrival time.
Reconnects share [revision and timestamp checkpoints](stream-conflicts.md) for
the same full identity. A gap closes any current passive view through the local
adapter cleanup contract.

Disconnect/error closes passive view handles through the existing projection and
retains the old observation with explicit offline/error status. No viewing or
control is possible while disconnected/loading/unknown. `canExecute` is always
false. `subscriptionCleanup` describes only the injected subscription handle,
not a server-side viewer revocation acknowledgment. The projection's existing
passive-view close limitation remains: actual KasmVNC revocation, asynchronous
viewer cleanup and handback require issue #11's authorized adapter and tests.

This object has no persistence, automatic retries, timer, autonomous reconnect,
network client or cross-process/concurrency guarantee. A real adapter must provide
bounded acquisition/read deadlines and cancellation cleanup. A stalled injected
promise remains loading until invalidated, then unknown and blocks further
acquisition. The coordinator retains at most one unresolved acquisition; this is
not a bound on resources allocated internally by the injected adapter. No claim
of live backend compatibility or production unsubscribe follows from synthetic
close acknowledgments.

## BDD verification

- Given subscription events racing a snapshot, when it resolves, then only
  validated buffered observations newer than the snapshot can advance the model.
- Given task switch/disconnect/overflow, when old callbacks or handles arrive,
  then they cannot repopulate the selected task and owned handles close.
- Given unknown unsubscribe outcome, when reconnect is requested, then no new
  subscription call occurs and uncertainty remains visible.
- Given pending acquisition A, when B/C or reconnect is requested after invalidation,
  then only A was subscribed, callbacks are fenced, and cleanup remains unknown.
- Given a valid late handle, when synchronous close confirms unsubscribe, then it
  closes exactly once and only an explicit new request may subscribe again.
- Given rejected acquisition or missing/malformed/throwing/asynchronous cleanup,
  when later requests arrive, then no new subscription is created.
- Given an acquired subscription, when abort or cleanup callbacks reenter connect,
  then the new call is refused until teardown completes and allocated synthetic
  subscriptions never overlap.
- Given a passive view, when the stream disconnects, then close is requested and
  no control call occurs; server-side revocation remains unverified.

Run `npm test` and `python3 tools/validate.py`. The new tests use synthetic callback
spies and no network. A subprocess mutation disables the buffer bound and must
fail the independently asserted overflow status. Another removes the pending
acquisition guard and must fail the independently asserted subscribe-call count
in the synthetic navigation regression. Temporary files are removed in
`finally`; subprocess runtime is bounded. UI/accessibility/live/native/durability
acceptance and isolated runner CI are not established by these component tests.
