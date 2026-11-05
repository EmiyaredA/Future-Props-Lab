"""Account-bound media description and borrowed content, without storage paths."""

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class MediaDescription:
    id: str
    revision: int
    owner_user_id: str
    media_kind: str
    mime_type: str
    original_filename: str


class MediaContent(Protocol):
    """A single-consumer stream valid only inside its source's borrow context.

    The source authorizes the account before returning this handle, detaches metadata
    from storage, and closes the stream on every exit, including cancellation.
    Consumers cannot retain the handle, mutate its source, or infer a host path.
    """

    @property
    def description(self) -> MediaDescription: ...

    async def read(self, size: int = -1) -> bytes: ...
