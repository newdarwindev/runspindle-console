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
the currently retained head remain ignored. A reconnect explicitly obtains a new
snapshot; no durable high-water semantics are added to this generic adapter.

Tests exercise real JavaScript orchestration with controlled synthetic adapters,
including open-view closure and no subsequent view call. No native desktop,
provider, control operation or authenticated backend is invoked.
