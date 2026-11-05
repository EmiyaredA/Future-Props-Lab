from __future__ import annotations

# ruff: noqa: F401
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile

from studio.apps.galgame_workshop.assets.asr import GalgameAsrService
from studio.apps.galgame_workshop.assets.assets import GalgameProjectAssets
from studio.apps.galgame_workshop.assets.maintenance import GalgameMaintenance
from studio.apps.galgame_workshop.assets.portrait_maintenance import GalgamePortraitMaintenance
from studio.apps.galgame_workshop.errors import (
    GalgameStoryDocumentInvalidError,
    GalgameStoryDocumentNotFoundError,
    GalgameStoryNotReadyError,
    GalgameWorkshopProjectNotFoundError,
)
from studio.apps.galgame_workshop.readiness import GalgameReadiness
from studio.apps.galgame_workshop.schemas import (
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
from studio.apps.galgame_workshop.story.story import GalgameStoryDocuments
from studio.apps.galgame_workshop.website.projects import GalgameWorkshopProjects
from studio.assembly.http_dependencies import SessionDep
from studio.config.settings import get_settings
from studio.contracts.asset_library.errors import AssetError


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
