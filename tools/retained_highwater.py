"""Local retained-observation fence; not a permission or freshness service."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import sys
from pathlib import Path

SCHEMA = "CREATE TABLE fence (id INTEGER PRIMARY KEY CHECK(id=1), binding TEXT NOT NULL, revision INTEGER NOT NULL, digest TEXT NOT NULL)"


def require(value: bool) -> None:
    if not value:
        raise ValueError("retained fence rejected")


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
                db.execute(SCHEMA)
                db.execute("PRAGMA user_version=1")
                db.execute("INSERT INTO fence VALUES (1,'',0,'')")
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
            revision = record.get("revision")
            require(type(revision) is int and 0 < revision <= 9007199254740991)
            digest = hashlib.sha256(
                json.dumps(record, sort_keys=True, separators=(",", ":")).encode()
            ).hexdigest()
            db.execute("BEGIN IMMEDIATE")
            require(db.execute("PRAGMA user_version").fetchone() == (1,))
            require(
                db.execute(
                    "SELECT sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'"
                ).fetchall()
                == [(SCHEMA,)]
            )
            rows = db.execute("SELECT id,binding,revision,digest FROM fence").fetchall()
            require(len(rows) == 1)
            if rows:
                ident, binding, previous, accepted = rows[0]
                require(ident == 1)
                require(
                    (binding, previous, accepted) == ("", 0, "")
                    or (
                        binding == value["binding"]
                        and type(previous) is int
                        and 0 < previous <= 9007199254740991
                        and type(accepted) is str
                        and re.fullmatch(r"[0-9a-f]{64}", accepted) is not None
                    )
                )
                require(revision >= previous)
                require(revision != previous or digest == accepted)
            db.execute(
                "INSERT OR REPLACE INTO fence VALUES (1,?,?,?)",
                (value["binding"], revision, digest),
            )
            db.commit()
            return 0
        finally:
            db.close()
    except Exception:
        print("retained fence unavailable", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
