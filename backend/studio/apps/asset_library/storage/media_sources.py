"""Compatibility-site source lookup; no ORM or live read transaction escapes borrowing."""

from contextlib import ExitStack, asynccontextmanager

from sqlalchemy import select

from app.capabilities.asset_store.models import VisualAsset
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.asset_library.media_content import MediaDescription
from studio.runtime.files.borrowed_media import FileMediaContent


class StoredMediaSources:
    def __init__(self, sessions, storage):
        self.sessions, self.storage = sessions, storage

    @asynccontextmanager
    async def borrow(self, owner, asset_id):
        async with self.sessions(info={"owner_user_id": owner}) as session:
            row = await session.scalar(
                select(VisualAsset).where(
                    VisualAsset.id == asset_id, VisualAsset.owner_user_id == owner
                )
            )
            if row is None:
                raise AssetError("文件不存在", code="not_found", status=404)
            description = MediaDescription(
                row.id, row.revision, owner, row.media_kind, row.mime_type, row.original_filename
            )
            path = self.storage.path_for(row)
        # Authorization and metadata lookup finish before decoding or external processes.
        with ExitStack() as lease:
            try:
                content = lease.enter_context(FileMediaContent(description, path))
            except FileNotFoundError as exc:
                raise AssetError("文件不存在", code="not_found", status=404) from exc
            yield content
