from __future__ import annotations

# ruff: noqa: F405
from fastapi import APIRouter

from app.routes.galgame_workshop._shared import *  # noqa: F403
from app.routes.galgame_workshop._shared import _asset_error

router = APIRouter()


@router.get("/{project_id}/story/portrait-upgrade", response_model=GalgamePortraitUpgradePreviewOut)
async def preview_portrait_upgrade(
    session: SessionDep, project_id: str
) -> GalgamePortraitUpgradePreviewOut:
    return await GalgamePortraitMaintenance(session).preview(project_id)


@router.post("/{project_id}/story/portrait-upgrade", response_model=GalgameStoryDocumentOut)
async def apply_portrait_upgrade(
    session: SessionDep,
    project_id: str,
    body: GalgamePortraitUpgradeApplyIn,
) -> GalgameStoryDocumentOut:
    result = await GalgamePortraitMaintenance(session).apply(project_id, body)
    return result  # type: ignore[return-value]


@router.get("/{project_id}/story/snapshots", response_model=list[GalgameStorySnapshotOut])
async def list_story_snapshots(
    session: SessionDep, project_id: str
) -> list[GalgameStorySnapshotOut]:
    return await GalgamePortraitMaintenance(session).list_snapshots(project_id)


@router.post(
    "/{project_id}/story/snapshots/{snapshot_id}/restore",
    response_model=GalgameStoryDocumentOut,
)
async def restore_story_snapshot(
    session: SessionDep,
    project_id: str,
    snapshot_id: str,
    body: GalgameStorySnapshotRestoreIn,
) -> GalgameStoryDocumentOut:
    try:
        result = await GalgamePortraitMaintenance(session).restore(project_id, snapshot_id, body)
        return result  # type: ignore[return-value]
    except AssetError as exc:
        raise _asset_error(exc) from None
