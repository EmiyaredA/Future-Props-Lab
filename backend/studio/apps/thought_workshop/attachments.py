"""Thought document attachment upload through the shared managed file library."""

from sqlalchemy.ext.asyncio import AsyncSession

from studio.apps.asset_library.storage.uploads import AssetLibrary
from studio.apps.thought_workshop.schemas.workshop import ThoughtAttachmentOut
from studio.config.settings import Settings
from studio.contracts.asset_library.file_types import ATTACHMENT_EXTENSIONS
from studio.contracts.asset_library.incoming import IncomingFile


async def upload_attachment(
    session: AsyncSession, settings: Settings, owner_user_id: str, upload: IncomingFile
) -> ThoughtAttachmentOut:
    row = await AssetLibrary(session, settings).store_upload(
        upload, owner_user_id=owner_user_id, allowed_extensions=ATTACHMENT_EXTENSIONS
    )
    return ThoughtAttachmentOut(
        asset_id=row.id,
        filename=row.original_filename,
        mime_type=row.mime_type,
        byte_size=row.byte_size,
    )
