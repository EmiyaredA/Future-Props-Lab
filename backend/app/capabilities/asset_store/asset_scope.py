from __future__ import annotations

from app.capabilities.asset_store.library import AssetError
from app.capabilities.asset_store.models import VisualAsset


def ensure_library_managed(row: VisualAsset) -> None:
    scope = (
        "Galgame 工程素材必须在所属工程中管理"
        if row.galgame_project_id is not None
        else "视频剪辑素材必须在所属剪辑项目中管理"
        if row.video_editor_project_id is not None
        else "动效合成素材必须在所属动效项目中管理"
        if row.motion_compositor_project_id is not None
        else None
    )
    if scope:
        raise AssetError(scope, code="scope_mismatch", status=409)


def is_library_asset(row: VisualAsset) -> bool:
    return not (
        row.project_id
        or row.galgame_project_id
        or row.video_editor_project_id
        or row.motion_compositor_project_id
    )


def is_visual_project_asset(row: VisualAsset, project_id: str) -> bool:
    return row.project_id == project_id and not (
        row.galgame_project_id or row.video_editor_project_id or row.motion_compositor_project_id
    )
