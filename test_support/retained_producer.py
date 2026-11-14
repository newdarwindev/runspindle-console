"""Synthetic authenticated inputs through the actual pinned Tether writer."""

import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.retained_snapshot import load_source


def main() -> None:
    load_source(Path(sys.argv[1]))
    from tether.admission import Admission, Grant, Identity, canonical
    from tether.sanitization import Sanitizer

    identity = Identity("actor", "workspace", "channel", "thread")

    revision = 1

    def authorize(actor: Identity, digest: str) -> Grant:
        return Grant(
            actor,
            digest,
            "task",
            revision,
            "operation",
            "policy",
            "host",
            1,
            "grant",
            "synthetic",
        )

    a = Admission(
        sys.argv[2],
        lambda raw, proof: identity
        if proof == hashlib.sha256(raw).hexdigest()
        else None,
        authorize,
        Sanitizer(("PRIVATE_CANARY",)),
    )
    raw = canonical(
        dict(
            version="runspindle.tether.ingress.v1",
            event_id="event",
            message_id="input",
            actor_id="actor",
            workspace_id="workspace",
            channel_id="channel",
            thread_id="thread",
            revision=1,
            kind="create",
            text="synthetic",
            mirrored=False,
        )
    )
    a.ingest(raw, hashlib.sha256(raw).hexdigest())
    a.persist_projection(
        "task",
        1,
        dict(
            version="runspindle.projection.v1",
            kind="input",
            message="Retained <task> PRIVATE_CANARY",
        ),
    )
    if len(sys.argv) > 3:
        import json

        revision = 2
        event = json.loads(raw)
        event.update(event_id="event-2", revision=2, kind=sys.argv[3])
        if sys.argv[3] == "delete":
            event["text"] = ""
        changed = canonical(event)
        a.ingest(changed, hashlib.sha256(changed).hexdigest())
        if sys.argv[3] == "edit":
            a.persist_projection(
                "task",
                2,
                dict(
                    version="runspindle.projection.v1",
                    kind="input",
                    message="Updated retained text",
                ),
            )
    a.close()


if __name__ == "__main__":
    main()
