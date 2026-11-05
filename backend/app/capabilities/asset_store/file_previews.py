"""Legacy account adapter for the shared, account-free media preview operations."""

from app.capabilities.asset_store.assets import VisualAssets
from app.capabilities.media_rendering.preview_metadata import (
    cache_root,
    describe_preview,
    media_thumbnail,
    preview_kind,
)
from studio.contracts.asset_library.media_content import MediaDescription

__all__ = ["cache_root", "media_thumbnail", "preview_kind", "preview_metadata"]


async def authorized_source(session, settings, owner_user_id: str, asset_id: str):
    row, path = await VisualAssets(session, settings, owner_user_id).content(asset_id)
    info = MediaDescription(
        **{name: getattr(row, name) for name in MediaDescription.__dataclass_fields__}
    )
    await session.rollback()
    return info, path


async def preview_metadata(session, settings, owner_user_id: str, asset_id: str):
    info, source = await authorized_source(session, settings, owner_user_id, asset_id)
    return await describe_preview(settings, info, source)
