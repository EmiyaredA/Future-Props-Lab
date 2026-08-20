from __future__ import annotations

from collections import defaultdict, deque
from threading import Lock
from time import monotonic

_WINDOW_SECONDS = 300.0
_lock = Lock()
_attempts: dict[str, deque[float]] = defaultdict(deque)


def allow_attempt(key: str, limit: int) -> bool:
    now = monotonic()
    cutoff = now - _WINDOW_SECONDS
    with _lock:
        bucket = _attempts[key]
        while bucket and bucket[0] <= cutoff:
            bucket.popleft()
        if len(bucket) >= limit:
            return False
        bucket.append(now)
        return True


def clear_attempts(*keys: str) -> None:
    with _lock:
        for key in keys:
            _attempts.pop(key, None)
