"""Required source closure check before quality analysis; no fetch or fallback."""

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.retained_snapshot import load_source


def main() -> int:
    try:
        source = Path(os.environ["RUNSPINDLE_RETAINED_TETHER"])
        load_source(source.absolute())
    except Exception:
        print(json.dumps({"status": "failed", "reason": "retained_source_rejected"}))
        return 2
    print(json.dumps({"status": "passed", "evidence_class": "pinned_source_integrity"}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
