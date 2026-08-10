from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile

from app.core.config import get_settings
from app.deps import SessionDep
from app.files import AssetError
from app.galgame_workshop.asr import GalgameAsrService
from app.galgame_workshop.assets import GalgameProjectAssets
from app.galgame_workshop.errors import (
    GalgameStoryDocumentInvalidError,
    GalgameStoryDocumentNotFoundError,
    GalgameStoryNotReadyError,
    GalgameWorkshopProjectNotFoundError,
)
from app.galgame_workshop.portrait_maintenance import GalgamePortraitMaintenance
from app.galgame_workshop.projects import (
    GalgameWorkshopProjects,
)
from app.galgame_workshop.story import GalgameStoryDocuments
from app.schemas.galgame_workshop import (
    GalgameAsrSettingsOut,
    GalgameAsrSettingsPatchIn,
    GalgameAssetBatchUploadOut,
    GalgameAssetCategory,
    GalgameAssetImportPreviewIn,
    GalgameAssetImportPreviewOut,
    GalgameAssetOverviewOut,
    GalgameMissingAssetRepairIn,
    GalgamePackageManifestOut,
    GalgamePortraitUpgradeApplyIn,
    GalgamePortraitUpgradePreviewOut,
    GalgameProjectAssetListOut,
    GalgameProjectAssetOut,
    GalgameProjectAssetPatchIn,
    GalgameStoryDocumentOut,
    GalgameStoryDocumentPutIn,
    GalgameStoryRouteReportOut,
    GalgameStorySnapshotOut,
    GalgameStorySnapshotRestoreIn,
    GalgameTranscriptionCreateIn,
    GalgameTranscriptionTaskListOut,
    GalgameTranscriptPatchIn,
    GalgameVoiceMatchIn,
    GalgameVoiceMatchOut,
    GalgameWorkshopProjectCreateIn,
    GalgameWorkshopProjectListOut,
    GalgameWorkshopProjectOut,
    GalgameWorkshopProjectPatchIn,
)

router = APIRouter(prefix="/galgame-workshop/projects", tags=["galgame-workshop"])


def _not_found(
    exc: GalgameWorkshopProjectNotFoundError | GalgameStoryDocumentNotFoundError,
) -> HTTPException:
    return HTTPException(404, {"code": "not_found", "message": str(exc)})


def _invalid_story(exc: GalgameStoryDocumentInvalidError) -> HTTPException:
    return HTTPException(422, {"code": "invalid_story_document", "message": str(exc)})


def _asset_error(exc: AssetError) -> HTTPException:
    return HTTPException(
        exc.status,
        {"code": exc.code, "message": str(exc), **exc.detail},
    )


@router.get("", response_model=GalgameWorkshopProjectListOut)
async def list_projects(session: SessionDep) -> GalgameWorkshopProjectListOut:
    return await GalgameWorkshopProjects(session).list()


@router.post("", response_model=GalgameWorkshopProjectOut)
async def create_project(
    session: SessionDep,
    body: GalgameWorkshopProjectCreateIn,
) -> GalgameWorkshopProjectOut:
    return await GalgameWorkshopProjects(session).create(body)


@router.get("/{project_id}", response_model=GalgameWorkshopProjectOut)
async def get_project(session: SessionDep, project_id: str) -> GalgameWorkshopProjectOut:
    try:
        return await GalgameWorkshopProjects(session).get(project_id)
    except GalgameWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None


@router.get("/{project_id}/story", response_model=GalgameStoryDocumentOut)
async def get_story(session: SessionDep, project_id: str) -> GalgameStoryDocumentOut:
    try:
        return await GalgameStoryDocuments(session).get(project_id)
    except (
        GalgameWorkshopProjectNotFoundError,
        GalgameStoryDocumentNotFoundError,
    ) as exc:
        raise _not_found(exc) from None
    except GalgameStoryDocumentInvalidError as exc:
        raise _invalid_story(exc) from None


@router.put("/{project_id}/story", response_model=GalgameStoryDocumentOut)
async def put_story(
    session: SessionDep,
    project_id: str,
    body: GalgameStoryDocumentPutIn,
) -> GalgameStoryDocumentOut:
    try:
        return await GalgameStoryDocuments(session).put(project_id, body)
    except (
        GalgameWorkshopProjectNotFoundError,
        GalgameStoryDocumentNotFoundError,
    ) as exc:
        raise _not_found(exc) from None
    except GalgameStoryDocumentInvalidError as exc:
        raise _invalid_story(exc) from None


@router.get("/{project_id}/assets", response_model=GalgameProjectAssetListOut)
async def list_project_assets(
    session: SessionDep,
    project_id: str,
    query: str = Query(default="", max_length=255),
) -> GalgameProjectAssetListOut:
    try:
        return await GalgameProjectAssets(session, get_settings()).list(
            project_id, query=query.strip()
        )
    except GalgameWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None


@router.get("/{project_id}/assets/overview", response_model=GalgameAssetOverviewOut)
async def get_project_asset_overview(
    session: SessionDep, project_id: str
) -> GalgameAssetOverviewOut:
    try:
        return await GalgameProjectAssets(session, get_settings()).overview(project_id)
    except GalgameWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None


@router.post("/{project_id}/assets/import-preview", response_model=GalgameAssetImportPreviewOut)
async def preview_project_asset_import(
    session: SessionDep,
    project_id: str,
    body: GalgameAssetImportPreviewIn,
) -> GalgameAssetImportPreviewOut:
    try:
        return await GalgameProjectAssets(session, get_settings()).import_preview(
            project_id, body.filenames, body.category
        )
    except GalgameWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None


@router.post("/{project_id}/assets/batch", response_model=GalgameAssetBatchUploadOut)
async def batch_upload_project_assets(
    session: SessionDep,
    project_id: str,
    uploads: Annotated[list[UploadFile], File()],
    category: Annotated[GalgameAssetCategory, Form()],
) -> GalgameAssetBatchUploadOut:
    try:
        return await GalgameProjectAssets(session, get_settings()).batch_upload(
            project_id, uploads, category
        )
    except GalgameWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.post("/{project_id}/assets/metadata-scan", response_model=GalgameProjectAssetListOut)
async def scan_project_asset_metadata(
    session: SessionDep, project_id: str
) -> GalgameProjectAssetListOut:
    try:
        return await GalgameProjectAssets(session, get_settings()).scan_metadata(project_id)
    except GalgameWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None


@router.get("/{project_id}/assets/package-manifest", response_model=GalgamePackageManifestOut)
async def get_project_package_manifest(
    session: SessionDep, project_id: str
) -> GalgamePackageManifestOut:
    try:
        return await GalgameProjectAssets(session, get_settings()).package_manifest(project_id)
    except GalgameWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None


@router.patch("/{project_id}/assets/{asset_id}", response_model=GalgameProjectAssetOut)
async def patch_project_asset(
    session: SessionDep,
    project_id: str,
    asset_id: str,
    body: GalgameProjectAssetPatchIn,
) -> GalgameProjectAssetOut:
    try:
        return await GalgameProjectAssets(session, get_settings()).patch(project_id, asset_id, body)
    except (GalgameWorkshopProjectNotFoundError, AssetError) as exc:
        if isinstance(exc, GalgameWorkshopProjectNotFoundError):
            raise _not_found(exc) from None
        raise _asset_error(exc) from None


@router.post("/{project_id}/assets/repair", response_model=GalgameStoryDocumentOut)
async def repair_project_asset(
    session: SessionDep,
    project_id: str,
    body: GalgameMissingAssetRepairIn,
) -> GalgameStoryDocumentOut:
    try:
        result = await GalgameProjectAssets(session, get_settings()).repair_missing(
            project_id, body
        )
        return result  # type: ignore[return-value]
    except (GalgameWorkshopProjectNotFoundError, GalgameStoryDocumentNotFoundError) as exc:
        raise _not_found(exc) from None
    except (AssetError, GalgameStoryDocumentInvalidError) as exc:
        if isinstance(exc, AssetError):
            raise _asset_error(exc) from None
        raise _invalid_story(exc) from None


@router.post("/{project_id}/assets", response_model=GalgameProjectAssetOut)
async def upload_project_asset(
    session: SessionDep,
    project_id: str,
    upload: Annotated[UploadFile, File()],
    category: Annotated[GalgameAssetCategory | None, Form()] = None,
) -> GalgameProjectAssetOut:
    try:
        return await GalgameProjectAssets(session, get_settings()).upload(
            project_id, upload, category=category
        )
    except GalgameWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.get("/{project_id}/assets/asr/settings", response_model=GalgameAsrSettingsOut)
async def get_asr_settings(session: SessionDep, project_id: str) -> GalgameAsrSettingsOut:
    try:
        return await GalgameAsrService(session).get_settings(project_id)
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.patch("/{project_id}/assets/asr/settings", response_model=GalgameAsrSettingsOut)
async def patch_asr_settings(
    session: SessionDep, project_id: str, body: GalgameAsrSettingsPatchIn
) -> GalgameAsrSettingsOut:
    try:
        return await GalgameAsrService(session).patch_settings(project_id, body)
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.post(
    "/{project_id}/assets/asr/transcriptions",
    response_model=GalgameTranscriptionTaskListOut,
)
async def create_transcriptions(
    session: SessionDep, project_id: str, body: GalgameTranscriptionCreateIn
) -> GalgameTranscriptionTaskListOut:
    try:
        return await GalgameAsrService(session).create_tasks(project_id, body)
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.get(
    "/{project_id}/assets/asr/transcriptions",
    response_model=GalgameTranscriptionTaskListOut,
)
async def list_transcriptions(
    session: SessionDep, project_id: str
) -> GalgameTranscriptionTaskListOut:
    try:
        return await GalgameAsrService(session).list_tasks(project_id)
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.patch("/{project_id}/assets/{asset_id}/transcript")
async def patch_asset_transcript(
    session: SessionDep,
    project_id: str,
    asset_id: str,
    body: GalgameTranscriptPatchIn,
) -> object:
    try:
        return await GalgameAsrService(session).patch_transcript(project_id, asset_id, body)
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.post("/{project_id}/assets/asr/match-dialogue", response_model=GalgameVoiceMatchOut)
async def match_voice_to_dialogue(
    session: SessionDep, project_id: str, body: GalgameVoiceMatchIn
) -> GalgameVoiceMatchOut:
    try:
        return await GalgameAsrService(session).match_dialogue(project_id, body)
    except AssetError as exc:
        raise _asset_error(exc) from None


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


@router.delete("/{project_id}/assets/{asset_id}")
async def delete_project_asset(
    session: SessionDep,
    project_id: str,
    asset_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await GalgameProjectAssets(session, get_settings()).delete(
            project_id, asset_id, expected_revision
        )
    except GalgameWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None
    except AssetError as exc:
        raise HTTPException(
            exc.status,
            {"code": exc.code, "message": str(exc), **exc.detail},
        ) from None
    return {"deleted": True}


@router.get("/{project_id}/story/report", response_model=GalgameStoryRouteReportOut)
async def get_story_report(session: SessionDep, project_id: str) -> GalgameStoryRouteReportOut:
    try:
        return await GalgameStoryDocuments(session).report(project_id)
    except (
        GalgameWorkshopProjectNotFoundError,
        GalgameStoryDocumentNotFoundError,
    ) as exc:
        raise _not_found(exc) from None
    except GalgameStoryDocumentInvalidError as exc:
        raise _invalid_story(exc) from None


@router.patch("/{project_id}", response_model=GalgameWorkshopProjectOut)
async def patch_project(
    session: SessionDep,
    project_id: str,
    body: GalgameWorkshopProjectPatchIn,
) -> GalgameWorkshopProjectOut:
    try:
        return await GalgameWorkshopProjects(session).patch(project_id, body)
    except GalgameWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None
    except GalgameStoryNotReadyError as exc:
        raise HTTPException(
            422,
            {
                "code": "story_not_ready",
                "message": str(exc),
                "report": exc.report.model_dump(mode="json"),
            },
        ) from None


@router.delete("/{project_id}")
async def delete_project(
    session: SessionDep,
    project_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await GalgameWorkshopProjects(session).delete(project_id, expected_revision)
    except GalgameWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None
    return {"deleted": True}
