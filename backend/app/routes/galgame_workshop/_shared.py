from __future__ import annotations

# ruff: noqa: F401
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
from app.galgame_workshop.maintenance import GalgameMaintenance
from app.galgame_workshop.portrait_maintenance import GalgamePortraitMaintenance
from app.galgame_workshop.projects import (
    GalgameWorkshopProjects,
)
from app.galgame_workshop.readiness import GalgameReadiness
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
