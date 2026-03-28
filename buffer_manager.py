import json
import threading
from typing import Any, Dict, List


class BufferManager:
    """Thread-safe in-memory JSON buffer for batched payloads."""

    def __init__(self) -> None:
        self._buffer: List[Dict[str, Any]] = []
        self._lock = threading.Lock()

    def add(self, item: Dict[str, Any]) -> None:
        with self._lock:
            self._buffer.append(item)

    def get_all(self) -> List[Dict[str, Any]]:
        with self._lock:
            return list(self._buffer)

    def clear(self) -> None:
        with self._lock:
            self._buffer.clear()

    def to_json(self) -> str:
        with self._lock:
            return json.dumps(self._buffer, ensure_ascii=True)
