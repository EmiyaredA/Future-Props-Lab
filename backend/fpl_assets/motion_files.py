"""Resolve only the requested account and project file metadata."""

from sqlalchemy import select

from app.capabilities.asset_store.errors import AssetError
from app.capabilities.asset_store.models import VisualAsset
from fpl_runtime.motion_assets import MotionAsset


async def describe(session, owner, project_id, asset_ids):
    if session.info.get("owner_user_id") != owner:
        raise ValueError("特效素材请求缺少匹配的账号上下文")
    rows = list(
        await session.scalars(
            select(VisualAsset)
            .where(
                VisualAsset.owner_user_id == owner,
                VisualAsset.motion_compositor_project_id == project_id,
                VisualAsset.id.in_(asset_ids),
            )
            .order_by(VisualAsset.id)
        )
    )
    if [row.id for row in rows] != asset_ids:
        raise AssetError("特效项目素材不存在", code="motion_project_asset_missing", status=404)
    return [
        MotionAsset(**{field: getattr(row, field) for field in MotionAsset.model_fields})
        for row in rows
    ]
