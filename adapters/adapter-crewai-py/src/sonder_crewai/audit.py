from __future__ import annotations

import json
from pathlib import Path
from threading import Lock

from .event import SonderEvent


class SonderAuditLogger:
    """Thread-safe JSONL writer for SonderEvents."""

    def __init__(self, path: str | Path) -> None:
        self._path = Path(path)
        self._lock = Lock()
        self._path.parent.mkdir(parents=True, exist_ok=True)

    def log(self, event: SonderEvent) -> None:
        with self._lock:
            with open(self._path, "a") as f:
                f.write(json.dumps(event.to_dict()) + "\n")
