"""Local retained-observation fence; not a permission or freshness service."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import sys
from pathlib import Path
from typing import Any

SCHEMA_V1 = "CREATE TABLE fence (id INTEGER PRIMARY KEY CHECK(id=1), binding TEXT NOT NULL, revision INTEGER NOT NULL, digest TEXT NOT NULL)"
DELETION_COLUMN = "deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1))"
SCHEMA_V2 = SCHEMA_V1[:-1] + ", " + DELETION_COLUMN + ")"


def require(value: bool) -> None:
    if not value:
        raise ValueError("retained fence rejected")


def record_digest(record: dict[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(record, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def advance(db: sqlite3.Connection, source: str, record: dict[str, Any]) -> None:
    revision = record.get("revision")
    require(type(revision) is int and 0 < revision <= 9007199254740991)
    deleted = record.get("deleted", False)
    require(type(deleted) is bool and (not deleted or record.get("label") == ""))
    digest = record_digest(record)
    db.execute("BEGIN IMMEDIATE")
    (version,) = db.execute("PRAGMA user_version").fetchone()
    require(version in (1, 2))
    schema = SCHEMA_V1 if version == 1 else SCHEMA_V2
    require(
        db.execute(
            "SELECT sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'"
        ).fetchall()
        == [(schema,)]
    )
    rows = db.execute("SELECT * FROM fence").fetchall()
    require(len(rows) == 1)
    ident, binding, previous, accepted = rows[0][:4]
    require(ident == 1)
    require(
        (binding, previous, accepted) == ("", 0, "")
        or (
            binding == source
            and type(previous) is int
            and 0 < previous <= 9007199254740991
            and type(accepted) is str
            and re.fullmatch(r"[0-9a-f]{64}", accepted) is not None
        )
    )
    if version == 1:
        # The exact reader fixes all other decoded fields for this identity.
        # Recognize an old digest that explicitly included a deletion bit.
        tombstone = dict(record, revision=previous, label="", deleted=True)
        terminal = accepted == record_digest(tombstone)
    else:
        saved = rows[0][4]
        require(type(saved) is int and saved in (0, 1) and (not saved or previous > 0))
        terminal = saved == 1
    require(revision >= previous)
    require(not terminal or revision == previous)
    require(revision != previous or digest == accepted)
    if version == 1:
        db.execute("ALTER TABLE fence ADD COLUMN " + DELETION_COLUMN)
        db.execute("PRAGMA user_version=2")
    db.execute(
        "INSERT OR REPLACE INTO fence VALUES (1,?,?,?,?)",
        (source, revision, digest, int(deleted)),
    )
    db.commit()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=Path)
    parser.add_argument("--initialize", action="store_true")
    args = parser.parse_args()
    try:
        # No implicit recreation: a lost database must remain unavailable.
        if args.initialize:
            with args.path.open("xb"):
                pass
        require(args.path.is_file() and not args.path.is_symlink())
        require(args.path.stat().st_size <= 65536)
        for suffix in ("-wal", "-journal", "-shm"):
            sidecar = Path(str(args.path) + suffix)
            require(
                not sidecar.is_symlink()
                and (
                    not sidecar.exists()
                    or (
                        not sidecar.is_symlink()
                        and sidecar.is_file()
                        and sidecar.stat().st_size <= 65536
                    )
                )
            )
        db = sqlite3.connect(
            args.path.absolute().as_uri() + "?mode=rw", uri=True, timeout=0.1
        )
        try:
            db.execute("PRAGMA synchronous=FULL")
            if args.initialize:
                db.execute("BEGIN IMMEDIATE")
                db.execute(SCHEMA_V2)
                db.execute("PRAGMA user_version=2")
                db.execute("INSERT INTO fence VALUES (1,'',0,'',0)")
                db.commit()
                return 0
            raw = sys.stdin.buffer.read(16385)
            require(len(raw) <= 16384)
            value = json.loads(raw)
            require(type(value) is dict and set(value) == {"binding", "record"})
            require(
                type(value["binding"]) is str
                and re.fullmatch(r"[0-9a-f]{64}", value["binding"]) is not None
            )
            record = value["record"]
            require(type(record) is dict)
            advance(db, value["binding"], record)
            return 0
        finally:
            db.close()
    except Exception:
        print("retained fence unavailable", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
