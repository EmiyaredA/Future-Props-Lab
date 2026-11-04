"""Read scoped video originals without a Video Editor database dependency."""

from sqlalchemy import select

from app.capabilities.asset_store.errors import AssetError
from app.capabilities.asset_store.models import VisualAsset
from fpl_runtime.video_assets import VideoAsset


async def describe(session, owner, project_id, asset_ids):
    if session.info.get("owner_user_id") != owner:
        raise ValueError("剪辑素材请求缺少匹配的账号上下文")
    rows = (
        await session.scalars(
            select(VisualAsset)
            .where(
                VisualAsset.owner_user_id == owner,
                VisualAsset.video_editor_project_id == project_id,
                VisualAsset.id.in_(asset_ids),
            )
            .order_by(VisualAsset.id)
        )
    ).all()
    if [row.id for row in rows] != asset_ids:
        raise AssetError("剪辑项目素材不存在", code="video_project_asset_missing", status=404)
    return [
        VideoAsset(**{field: getattr(row, field) for field in VideoAsset.model_fields})
        for row in rows
    ]
