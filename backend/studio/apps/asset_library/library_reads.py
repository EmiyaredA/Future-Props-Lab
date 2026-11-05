"""Read only the authenticated account's ordinary library files."""

from sqlalchemy import select

from app.capabilities.asset_store.errors import AssetError
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage
from studio.contracts.asset_library.descriptions import LibraryAssetDescription


async def describe(session, owner, ids, *, description=LibraryAssetDescription):
    if session.info.get("owner_user_id") != owner:
        raise ValueError("素材请求缺少匹配的账号上下文")
    rows = (
        list(
            await session.scalars(
                select(VisualAsset).where(
                    VisualAsset.id.in_(ids),
                    VisualAsset.owner_user_id == owner,
                    VisualAsset.project_id.is_(None),
                    VisualAsset.galgame_project_id.is_(None),
                    VisualAsset.video_editor_project_id.is_(None),
                    VisualAsset.motion_compositor_project_id.is_(None),
                )
            )
        )
        if ids
        else []
    )
    if {row.id for row in rows} != set(ids):
        raise AssetError("文件不存在", code="not_found", status=404)
    return {
        row.id: description(**{field: getattr(row, field) for field in description.model_fields})
        for row in rows
    }


async def content(session, settings, owner, asset_id, revision):
    values = await describe(session, owner, {asset_id})
    description = values[asset_id]
    if description.revision != revision:
        raise AssetError("文件版本已变化", code="source_changed", status=409)
    row = await session.scalar(
        select(VisualAsset).where(VisualAsset.id == asset_id, VisualAsset.owner_user_id == owner)
    )
    path = AssetStorage(settings).path_for(row)
    if path.is_symlink() or not path.is_file():
        raise AssetError("文件不存在", code="not_found", status=404)
    if path.stat().st_size != description.byte_size:
        raise AssetError("文件大小与记录不一致", code="source_changed", status=503)
    return description, path
