from __future__ import annotations


class RevisionConflictError(Exception):
    def __init__(self, expected: int, current: int, snapshot: dict) -> None:
        super().__init__(f"catalog revision conflict: expected {expected}, current {current}")
        self.expected = expected
        self.current = current
        self.snapshot = snapshot
