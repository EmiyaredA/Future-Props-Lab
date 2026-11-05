"""Process-local attempt windows owned by one application's lifecycle.

This mechanism only limits attempts; business adapters select keys and limits.
It is not a durable account lock or an authorization decision.
"""

from collections import defaultdict, deque
from threading import Lock
from time import monotonic


class AttemptLimiter:
    def __init__(self, *, window_seconds=300.0, clock=monotonic):
        self.window_seconds = window_seconds
        self.clock = clock
        self._lock = Lock()
        self._attempts: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str, limit: int) -> bool:
        now = self.clock()
        cutoff = now - self.window_seconds
        with self._lock:
            bucket = self._attempts[key]
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if len(bucket) >= limit:
                return False
            bucket.append(now)
            return True

    def clear(self, *keys: str) -> None:
        with self._lock:
            for key in keys:
                self._attempts.pop(key, None)
