# Stream conflict invalidation

Partial Console #9 implementation, not authenticated runtime qualification.
The process-local stream adapter preserves benign retransmission and older
observations, but a conflicting payload at the current revision or a newer
revision with an older known source timestamp invalidates the subscription.
It retains the last accepted observation, marks status unknown, requests abort,
and closes its passive view and subscription. A late event cannot restore ready
state. Failed cleanup retains the existing unknown-cleanup fence.

The same checks apply while draining events buffered during snapshot acquisition.
Only bounded normalized fields are compared; derived gap state is not a provider
field. This is not arbitrary historical conflict detection: revisions older than
the currently retained head remain ignored as events. Reconnect and navigation
preserve the last accepted revision, normalized content and last known source
timestamp for each full identity in the coordinator. A missing timestamp leaves
freshness unknown and preserves the last known timestamp for comparisons. A
complete reconnect snapshot must meet the revision floor and may clear a gap
with an identical snapshot at the current revision. An empty snapshot after
an observation, a lower snapshot, changed content at the same revision, or a
regressed source timestamp closes the subscription and gives an unknown state.

The coordinator tracks up to 128 identities and refuses additional identities
without opening new subscriptions. It keeps earlier checkpoints until disposal.
This is process-local and scoped to the configured adapter. Where the bounded
retained SQLite adapter has its own high-water check, that check still happens
before the adapter acknowledges a regressed poll.

A sequence gap releases the current passive viewer through its existing local
cleanup contract. A complete valid snapshot is required before viewing can resume.

Tests exercise JavaScript orchestration with controlled synthetic adapters,
including open-view closure and no subsequent view call, and use the exact
pinned Tether SQLite producer for retained-stream integration. The deliberate
reconnect mutation allows a regressed snapshot and fails the independent
passive-view assertion. Local results are in
[`stream-reconnect-evidence.json`](../docs/stream-reconnect-evidence.json).
