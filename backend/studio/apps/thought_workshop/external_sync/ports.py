"""Thought-owned external document access, bound to an authorized account by assembly."""

from typing import Protocol

from studio.contracts.integrations.external_connections import ExternalTargetOut
from studio.contracts.integrations.external_documents import (
    ConnectionSnapshot,
    ImageSource,
    RemoteDocument,
)


class ArticleDocumentClient(Protocol):
    """Never replay a timed-out write; the caller persists a step before dispatch.

    Reads observe revisions rather than promising remote CAS. Cancellation must
    close transport resources, and the task owner decides the final outcome.
    """

    async def read(self, document_id: str) -> RemoteDocument: ...
    async def can_write(self, document_id: str) -> bool: ...
    async def append(
        self, document_id: str, tree: dict, revision: int, request_id: str
    ) -> dict: ...
    async def upload_image(self, document_id: str, block_id: str, image: ImageSource) -> str: ...
    async def replace_image(
        self, document_id: str, block_id: str, token: str, revision: int, request_id: str
    ) -> dict: ...
    async def delete_prefix(
        self, document_id: str, count: int, revision: int, request_id: str
    ) -> dict: ...


class ArticleConnections(Protocol):
    """All lookups enforce the bound account; snapshots contain no storage objects."""

    async def get(self, id: str) -> ConnectionSnapshot: ...
    async def require_enabled(
        self, id: str, *, expected_revision: int | None = None
    ) -> ConnectionSnapshot: ...
    async def resolve_document(self, id: str, url: str) -> tuple[str, str]: ...
    async def target(self, id: str, url: str) -> ExternalTargetOut: ...
    async def client(
        self, id: str, *, expected_revision: int | None = None
    ) -> ArticleDocumentClient: ...
