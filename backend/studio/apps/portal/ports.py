"""Document sources return values without granting arbitrary filesystem access."""

from typing import Protocol


class DocumentSource(Protocol):
    def read(self) -> list[dict[str, str]]:
        """Read only the installed allowlist, excluding credentials and private resources."""
        ...
