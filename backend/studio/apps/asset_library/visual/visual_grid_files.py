"""Validate project originals for new or retried Visual grid attempts."""

from sqlalchemy import select

from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage
from studio.apps.asset_library.scoped_project_files import check_project_scope
from studio.apps.asset_library.visual.visual_snapshot_files import scoped_assets
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.asset_library.file_types import REFERENCE_IMAGE_MIME_TYPES
from studio.contracts.visual_workshop.visual_composition import MAX_IMAGE_BYTES, GridAsset


async def grid_files(session, settings, project_id, asset_ids):
    owner = session.info["owner_user_id"]
    await check_project_scope(session, "visual", project_id)
    assets = await scoped_assets(
        session, project_id, asset_ids, include_private=False, include_pinned=False
    )
    missing = set(asset_ids) - {row.id for row, _ in assets}
    if missing:
        known = set(
            await session.scalars(
                select(VisualAsset.id).where(
                    VisualAsset.owner_user_id == owner,
                    VisualAsset.id.in_(missing),
                )
            )
        )
        if missing - known:
            raise AssetError("参考图片不存在", code="invalid_reference", status=404)
        raise AssetError("参考图片不属于当前项目", code="scope_mismatch", status=422)
    storage = AssetStorage(settings)
    for row, _ in assets:
        if row.media_kind != "image" or row.mime_type not in REFERENCE_IMAGE_MIME_TYPES:
            raise AssetError("参考图片格式不受支持", code="invalid_reference", status=422)
        path = storage.path_for(row)
        if path.is_symlink() or not path.is_file():
            raise AssetError("参考图片文件已不存在", code="invalid_reference", status=404)
        if row.byte_size > MAX_IMAGE_BYTES:
            raise AssetError("单张参考图片不能超过 30 MB", code="reference_too_large", status=422)
    return [GridAsset.model_validate(row, from_attributes=True) for row, _ in assets]
