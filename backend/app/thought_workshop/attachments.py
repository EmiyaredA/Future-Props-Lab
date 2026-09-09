"""Thought document attachment upload through the shared managed file library."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.files.incoming import IncomingFile
from app.files.library import AssetLibrary
from app.files.policy import ATTACHMENT_EXTENSIONS
from app.schemas.thought_workshop import ThoughtAttachmentOut


async def upload_attachment(
    session: AsyncSession, settings: Settings, workspace_id: str, upload: IncomingFile
) -> ThoughtAttachmentOut:
    row = await AssetLibrary(session, settings).store_upload(
        upload, workspace_id=workspace_id, allowed_extensions=ATTACHMENT_EXTENSIONS
    )
    return ThoughtAttachmentOut(
        asset_id=row.id,
        filename=row.original_filename,
        mime_type=row.mime_type,
        byte_size=row.byte_size,
    )
