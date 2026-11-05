from __future__ import annotations

from studio.apps.asset_library.storage.models import VisualAsset
from studio.contracts.asset_library.errors import AssetError


def ensure_library_managed(row: VisualAsset) -> None:
    scope = (
        "Galgame 工程素材必须在所属工程中管理"
        if row.galgame_project_id is not None
        else "视频剪辑素材必须在所属剪辑项目中管理"
        if row.video_editor_project_id is not None
        else "特效制作素材必须在所属特效项目中管理"
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
