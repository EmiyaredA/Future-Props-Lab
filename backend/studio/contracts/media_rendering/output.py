"""Owned derived content survives its input lease and is released after response completion."""

from contextlib import AbstractContextManager
from typing import BinaryIO, Protocol


class MediaOutput(Protocol):
    filename: str
    media_type: str
    byte_size: int

    def open(self) -> AbstractContextManager[BinaryIO]: ...

    def close(self) -> None:
        """Idempotently release temporary output; persistent caches keep their contents."""
        ...
