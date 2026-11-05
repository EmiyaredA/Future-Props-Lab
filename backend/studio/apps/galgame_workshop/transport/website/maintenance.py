from __future__ import annotations

from fastapi import APIRouter

from app.capabilities.asset_store import AssetError
from studio.apps.galgame_workshop.assets.portrait_maintenance import GalgamePortraitMaintenance
from studio.apps.galgame_workshop.schemas import (
    GalgamePortraitUpgradeApplyIn,
    GalgamePortraitUpgradePreviewOut,
    GalgameStoryDocumentOut,
    GalgameStorySnapshotOut,
    GalgameStorySnapshotRestoreIn,
)
from studio.apps.galgame_workshop.transport.website._shared import _asset_error
from studio.assembly.http_dependencies import SessionDep

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
