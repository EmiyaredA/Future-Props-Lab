from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, File, Form, UploadFile

from app.core.config import get_settings
from app.deps import SessionDep
from app.galgame_workshop.errors import (
    GalgameStoryDocumentInvalidError,
    GalgameStoryDocumentNotFoundError,
    GalgameWorkshopProjectNotFoundError,
)
from app.galgame_workshop.readiness import GalgameReadiness
from app.galgame_workshop.story import GalgameStoryDocuments
from app.galgame_workshop.story_migrations import GalgameStoryMigrations
from app.galgame_workshop.story_patches import GalgameStoryPatches
from app.routes.galgame_workshop._shared import _invalid_story, _not_found
from app.schemas.galgame_workshop import (
    GalgameStoryDialoguePatchIn,
    GalgameStoryDialoguePatchOut,
    GalgameStoryDocumentOut,
    GalgameStoryDocumentPutIn,
    GalgameStoryRouteReportOut,
    GalgameStoryStageExpressionPatchIn,
    GalgameStoryStageExpressionPatchOut,
)

router = APIRouter()
MAX_STORY_IMPORT_BYTES = 10 * 1024 * 1024


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


@router.patch("/{project_id}/story/dialogue", response_model=GalgameStoryDialoguePatchOut)
async def patch_story_dialogue(
    session: SessionDep,
    project_id: str,
    body: GalgameStoryDialoguePatchIn,
) -> GalgameStoryDialoguePatchOut:
    try:
        return await GalgameStoryPatches(session).patch_dialogue(project_id, body)
    except (
        GalgameWorkshopProjectNotFoundError,
        GalgameStoryDocumentNotFoundError,
    ) as exc:
        raise _not_found(exc) from None
    except GalgameStoryDocumentInvalidError as exc:
        raise _invalid_story(exc) from None


@router.patch(
    "/{project_id}/story/stage-expression",
    response_model=GalgameStoryStageExpressionPatchOut,
)
async def patch_story_stage_expression(
    session: SessionDep,
    project_id: str,
    body: GalgameStoryStageExpressionPatchIn,
) -> GalgameStoryStageExpressionPatchOut:
    try:
        return await GalgameStoryPatches(session).patch_stage_expression(project_id, body)
    except (
        GalgameWorkshopProjectNotFoundError,
        GalgameStoryDocumentNotFoundError,
    ) as exc:
        raise _not_found(exc) from None
    except GalgameStoryDocumentInvalidError as exc:
        raise _invalid_story(exc) from None


@router.post("/{project_id}/story/import", response_model=GalgameStoryDocumentOut)
async def import_legacy_story(
    session: SessionDep,
    project_id: str,
    expected_revision: Annotated[int, Form(alias="expectedRevision", ge=0)],
    file: Annotated[UploadFile, File()],
) -> GalgameStoryDocumentOut:
    try:
        payload = await file.read(MAX_STORY_IMPORT_BYTES + 1)
        if len(payload) > MAX_STORY_IMPORT_BYTES:
            raise GalgameStoryDocumentInvalidError("Story 导入文件不能超过 10 MB")
        try:
            document = json.loads(payload.decode("utf-8-sig"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise GalgameStoryDocumentInvalidError("Story 导入文件不是有效的 UTF-8 JSON") from exc
        return await GalgameStoryMigrations(session).import_legacy(
            project_id,
            expected_revision=expected_revision,
            document=document,
        )
    except (
        GalgameWorkshopProjectNotFoundError,
        GalgameStoryDocumentNotFoundError,
    ) as exc:
        raise _not_found(exc) from None
    except GalgameStoryDocumentInvalidError as exc:
        raise _invalid_story(exc) from None
    finally:
        await file.close()


@router.get("/{project_id}/story/report", response_model=GalgameStoryRouteReportOut)
async def get_story_report(session: SessionDep, project_id: str) -> GalgameStoryRouteReportOut:
    try:
        return await GalgameReadiness(session, get_settings()).report(project_id)
    except (
        GalgameWorkshopProjectNotFoundError,
        GalgameStoryDocumentNotFoundError,
    ) as exc:
        raise _not_found(exc) from None
    except GalgameStoryDocumentInvalidError as exc:
        raise _invalid_story(exc) from None
