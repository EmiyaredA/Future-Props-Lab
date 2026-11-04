from sqlalchemy import select

from app.capabilities.asset_store.models import VisualAsset, VisualProjectAssetReference

from .project_access import AcceptanceError


async def asset(session, owner_user_id, project_id, asset_id):
    row = await session.scalar(
        select(VisualAsset).where(
            VisualAsset.id == asset_id, VisualAsset.owner_user_id == owner_user_id
        )
    )
    ref = await session.scalar(
        select(VisualProjectAssetReference.id).where(
            VisualProjectAssetReference.project_id == project_id,
            VisualProjectAssetReference.owner_user_id == owner_user_id,
            VisualProjectAssetReference.asset_id == asset_id,
        )
    )
    if row is None or (row.project_id != project_id and not ref):
        raise AcceptanceError("参考素材不存在或不属于项目", "not_found", 404)
    return row
