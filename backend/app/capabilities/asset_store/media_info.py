"""Workspace-scoped, read-only video information."""

from sqlalchemy import select

from app.capabilities.asset_store.library import AssetError
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage
from app.capabilities.media_rendering.media_info import inspect_video_info
from app.runtime.config import get_settings


async def get_video_media_info(session, workspace_id: str, asset_id: str) -> dict:
    asset = await session.scalar(
        select(VisualAsset).where(
            VisualAsset.id == asset_id,
            VisualAsset.workspace_id == workspace_id,
        )
    )
    if asset is None:
        raise AssetError("视频文件不存在", code="not_found", status=404)
    if asset.media_kind != "video":
        raise AssetError("格式检查只支持视频文件")
    path = AssetStorage(get_settings()).path_for(asset)
    await session.rollback()
    try:
        return await inspect_video_info(path)
    except (OSError, ValueError, TimeoutError):
        raise AssetError(
            "视频格式信息暂时无法读取", code="media_info_unavailable", status=422
        ) from None
