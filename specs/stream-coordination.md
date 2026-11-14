# Bounded process-local stream coordination

`createStreamProjection` in `src/stream.js` reuses the existing provisional
projection model. This is an original partial implementation for issues #1/#3,
and a seam for #9, not a runtime wire mapping or actual event-stream server.
Issues #9–11 remain blocked on their real transport, sanitization and authority
prerequisites. No UI, native desktop, durable store, credentials or control API
is added.

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

Connect deduplicates overlapping calls for the same complete identity. Explicit
`disconnect()` then `connect()` resubscribes and obtains a new snapshot. Switching
task/session closes the old projection and subscription. A late subscription
handle is closed; a late callback or snapshot cannot become the current projection.
A late cleanup failure also invalidates a newer subscription.

## Observation bounds and transitions

Subscribe precedes snapshot acquisition. Events received meanwhile are validated
through the existing projection, copied to its known bounded fields and buffered.
No arbitrary adapter object graph or additional fields are retained. `maxBuffered`
is 1–1024 (default 64). Overflow or malformed/wrong-identity events terminate the
subscription and show unknown. Snapshot completion precedes buffered event replay;
duplicates and older observations never replace newer ones. Sequence gaps remain
unknown until explicit resubscription and a complete snapshot. Freshness still
uses observation time and the injected clock, not arrival time.

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
promise remains loading until the caller disconnects/disposes; memory stays
bounded. No claim of live backend compatibility follows from synthetic tests.

## BDD verification

- Given subscription events racing a snapshot, when it resolves, then only
  validated buffered observations newer than the snapshot can advance the model.
- Given task switch/disconnect/overflow, when old callbacks or handles arrive,
  then they cannot repopulate the selected task and owned handles close.
- Given unknown unsubscribe outcome, when reconnect is requested, then no new
  subscription call occurs and uncertainty remains visible.
- Given a passive view, when the stream disconnects, then close is requested and
  no control call occurs; server-side revocation remains unverified.

Run `npm test` and `python3 tools/validate.py`. The new tests use synthetic callback
spies and no network. A subprocess mutation disables the buffer bound and must
fail the independently asserted overflow status. Temporary files are removed in
`finally`; subprocess runtime is bounded. UI/accessibility/live/native/durability
acceptance and isolated runner CI are not established by these component tests.
