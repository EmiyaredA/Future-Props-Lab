"""Resolve account-owned Visual task inputs without transferring a storage path."""

from sqlalchemy import select, text

from app.capabilities.asset_store.errors import AssetError
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage
from fpl_runtime.library_assets import LibraryAssetDescription
from fpl_runtime.visual_generation import GenerationAssets

from .scoped_project_files import check_project_scope
from .visual_snapshot_files import scoped_assets


async def generation_metadata(session, settings, project, requested):
    await session.execute(text("BEGIN"))
    await check_project_scope(session, "visual", project)
    selected = await scoped_assets(
        session, project, requested, include_private=False, include_pinned=False
    )
    missing = set(requested) - {row.id for row, _ in selected}
    if missing:
        owner = session.info["owner_user_id"]
        known = set(
            await session.scalars(
                select(VisualAsset.id).where(
                    VisualAsset.owner_user_id == owner,
                    VisualAsset.id.in_(missing),
                )
            )
        )
        if missing - known:
            raise AssetError("参考素材不存在", code="invalid_reference", status=404)
        raise AssetError("参考素材不属于当前项目", code="scope_mismatch", status=422)
    storage = AssetStorage(settings)
    for row, _ in selected:
        path = storage.path_for(row)
        if path.is_symlink() or not path.is_file():
            raise AssetError("参考素材文件已不存在", code="invalid_reference", status=404)
    return GenerationAssets(
        items=[
            LibraryAssetDescription.model_validate(row, from_attributes=True) for row, _ in selected
        ],
        max_video_bytes=settings.fpl_visual_asset_max_bytes,
    )
