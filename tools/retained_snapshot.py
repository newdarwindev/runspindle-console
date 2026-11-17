#!/usr/bin/env python3
"""Read-only historical Tether snapshot; no live observation or authority."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import subprocess
import sys
from pathlib import Path
from typing import Any, NoReturn, cast

ROOT = Path(__file__).resolve().parents[1]
VERSION = "runspindle.console.retained.v1"
LATEST_VERSION = "runspindle.console.retained-head.v2"
LIMIT = 16384


def require(ok: object) -> None:
    if not ok:
        raise ValueError("retained snapshot rejected")


def canonical(value: object) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def pairs(values: list[tuple[str, Any]]) -> dict[str, Any]:
    result = {}
    for key, value in values:
        require(key not in result)
        result[key] = value
    return result


def reject_constant(_: str) -> NoReturn:
    raise ValueError("nonstandard JSON constant")


def parse(text: str) -> dict[str, Any]:
    require(type(text) is str and len(text.encode()) <= LIMIT)
    value = json.loads(text, object_pairs_hook=pairs, parse_constant=reject_constant)
    require(type(value) is dict and canonical(value) == text)
    return cast(dict[str, Any], value)


def identifier(value: object) -> None:
    require(
        type(value) is str and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", value)
    )


def counter(value: object) -> None:
    require(type(value) is int and 0 < value <= 9007199254740991)


def load_source(source: Path) -> dict[str, Any]:
    pin = json.loads((ROOT / "dependencies/tether-snapshot.json").read_bytes())
    require(source.is_dir() and not source.is_symlink())

    def git(*args: str) -> str:
        return subprocess.check_output(
            ["git", "-C", str(source), *args],
            text=True,
            stderr=subprocess.DEVNULL,
            timeout=10,
        ).strip()

    require(git("rev-parse", "HEAD") == pin["commit"])
    require(not git("status", "--porcelain") and not git("ls-files", "--others"))
    for name, expected in pin["files"].items():
        file = source / name
        require(
            file.is_file() and not file.is_symlink() and not file.parent.is_symlink()
        )
        require(hashlib.sha256(file.read_bytes()).hexdigest() == expected)
    require(not any(n == "tether" or n.startswith("tether.") for n in sys.modules))
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(source))
    return cast(dict[str, Any], pin)


def snapshot(
    source: Path, database: Path, task: str, revision: int | None
) -> list[dict[str, Any]]:
    identifier(task)
    latest = revision is None
    if not latest:
        counter(revision)
    pin = load_source(source)
    from tether.admission import SCHEMA
    from tether.sanitization import Sanitizer
    from tether.schema import inspect, inventory

    require(database.is_file() and not database.is_symlink())
    require(database.stat().st_size <= 16777216)
    wal = Path(str(database) + "-wal")
    require(not wal.exists() or wal.stat().st_size <= 16777216)
    model = sqlite3.connect(":memory:")
    try:
        model.executescript(SCHEMA)
        expected = inventory(model)
    finally:
        model.close()
    db = sqlite3.connect(
        database.absolute().as_uri() + "?mode=ro",
        uri=True,
        isolation_level=None,
        timeout=1,
    )
    steps = 0

    def bounded() -> int:
        nonlocal steps
        steps += 1
        return int(steps > 10000)

    db.set_progress_handler(bounded, 100)
    try:
        db.execute("BEGIN")
        # No initialization or adoption is allowed in this read-only consumer.
        require(inspect(db, expected, 0x54410001) is False)
        head = db.execute(
            "SELECT revision,scope,deleted FROM heads WHERE task=?", (task,)
        ).fetchone()
        if latest:
            require(head is not None and type(head[0]) is str)
            revision = int(head[0])
            counter(revision)
        require(
            head is not None
            and head[0] == str(revision)
            and type(head[2]) is int
            and head[2] in (0, 1)
        )
        revision = cast(int, revision)
        lengths = db.execute(
            "SELECT length(envelope),length(scope) FROM revisions WHERE task=? AND revision=?",
            (task, str(revision)),
        ).fetchone()
        require(
            lengths is not None
            and all(type(n) is int and 0 < n <= LIMIT for n in lengths)
        )
        row = db.execute(
            "SELECT scope,kind,digest,envelope FROM revisions WHERE task=? AND revision=?",
            (task, str(revision)),
        ).fetchone()
        require(row is not None and row[0] == head[1])
        scope = json.loads(row[0], parse_constant=reject_constant)
        require(type(scope) is list and len(scope) == 5 and canonical(scope) == row[0])
        for item in scope:
            identifier(item)
        envelope = parse(row[3])
        require(
            set(envelope)
            == {"version", "message_type", "message_id", "binding", "payload"}
        )
        require(
            envelope["version"] == "runspindle.envelope.v1"
            and envelope["message_type"] == "admission_request"
        )
        identifier(envelope["message_id"])
        binding, payload = envelope["binding"], envelope["payload"]
        require(
            type(binding) is dict
            and set(binding)
            == {
                "task_id",
                "revision",
                "operation_id",
                "policy_revision",
                "host_id",
                "workspace_id",
                "lease_epoch",
            }
        )
        for key in (
            "task_id",
            "operation_id",
            "policy_revision",
            "host_id",
            "workspace_id",
        ):
            identifier(binding[key])
        counter(binding["revision"])
        counter(binding["lease_epoch"])
        require(
            binding["task_id"] == task
            and binding["revision"] == revision
            and binding["workspace_id"] == scope[0]
        )
        require(
            type(payload) is dict
            and set(payload)
            == {
                "delivery_namespace",
                "delivery_id",
                "predecessor_revision",
                "normalized_digest",
                "grant_ref",
            }
        )
        for key in ("delivery_namespace", "delivery_id", "grant_ref"):
            identifier(payload[key])
        require(payload["delivery_id"] == envelope["message_id"])
        predecessor = payload["predecessor_revision"]
        require(
            predecessor is None
            if revision == 1
            else type(predecessor) is int and predecessor == revision - 1
        )
        require(
            type(row[2]) is str
            and re.fullmatch("[a-f0-9]{64}", row[2])
            and payload["normalized_digest"] == row[2]
        )
        require(
            row[1] in ("create", "edit", "delete")
            and (row[1] == "delete") == bool(head[2])
        )
        require((revision == 1) == (row[1] == "create"))
        delivery = db.execute(
            "SELECT digest FROM deliveries WHERE namespace=? AND event=?",
            (payload["delivery_namespace"], payload["delivery_id"]),
        ).fetchone()
        require(delivery == (row[2],))
        owner = db.execute(
            "SELECT task FROM sources WHERE scope=?", (canonical(scope[:4]),)
        ).fetchone()
        require(owner == (task,))
        label = ""
        if not head[2]:
            size = db.execute(
                "SELECT length(body) FROM sanitized_projections WHERE task=? AND revision=?",
                (task, str(revision)),
            ).fetchone()
            require(size is not None and type(size[0]) is int and 0 < size[0] <= LIMIT)
            stored = db.execute(
                "SELECT body FROM sanitized_projections WHERE task=? AND revision=?",
                (task, str(revision)),
            ).fetchone()
            projection = parse(stored[0])
            require(canonical(Sanitizer().project(projection)) == stored[0])
            label = projection.get("message", "")
            require(type(label) is str and len(label) <= 4096)
        identity = {
            "task": task,
            "host": binding["host_id"],
            "workspace": binding["workspace_id"],
        }
        frames = [
            {
                "version": LATEST_VERSION if latest else VERSION,
                "type": "begin",
                "sequence": 0,
                "identity": identity,
                "revision": revision,
                "source": pin["commit"],
            },
            {
                "version": LATEST_VERSION if latest else VERSION,
                "type": "snapshot",
                "sequence": 1,
                "identity": identity,
                "revision": revision,
                "label": label,
                "deleted": bool(head[2]),
                "observedAt": None,
                "authority": "unknown",
                "connection": "unknown",
            },
            {
                "version": LATEST_VERSION if latest else VERSION,
                "type": "end",
                "sequence": 2,
            },
        ]
        require(sum(len(canonical(frame).encode()) + 1 for frame in frames) <= LIMIT)
        return frames
    finally:
        db.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--task", required=True)
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--revision", type=int)
    selection.add_argument("--latest-head", action="store_true")
    args = parser.parse_args()
    try:
        frames = snapshot(
            args.source.absolute(), args.database.absolute(), args.task, args.revision
        )
        for frame in frames:
            print(canonical(frame))
        return 0
    except Exception:
        print(
            '{"status":"failed","reason":"retained_snapshot_rejected"}', file=sys.stderr
        )
        return 2


if __name__ == "__main__":
    sys.exit(main())
