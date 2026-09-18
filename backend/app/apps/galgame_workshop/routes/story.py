from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import ValidationError

from app.apps.galgame_workshop.errors import (
    GalgameStoryDocumentInvalidError,
    GalgameStoryDocumentNotFoundError,
    GalgameWorkshopProjectNotFoundError,
)
from app.apps.galgame_workshop.readiness import GalgameReadiness
from app.apps.galgame_workshop.routes._shared import _invalid_story, _not_found
from app.apps.galgame_workshop.schemas import (
    GalgameStoryDialoguePatchIn,
    GalgameStoryDialoguePatchOut,
    GalgameStoryDocumentOut,
    GalgameStoryDocumentPutIn,
    GalgameStoryEditsPatchIn,
    GalgameStoryRouteReportOut,
    GalgameStoryStageExpressionPatchIn,
    GalgameStoryStageExpressionPatchOut,
)
from app.apps.galgame_workshop.schemas.operations import GalgameOperationsIn
from app.apps.galgame_workshop.story.operations import apply_operations as galgame_operations
from app.apps.galgame_workshop.story.story import GalgameStoryDocuments
from app.apps.galgame_workshop.story.story_migrations import GalgameStoryMigrations
from app.apps.galgame_workshop.story.story_patches import GalgameStoryPatches
from app.deps import SessionDep, WorkspaceDep
from app.runtime.config import get_settings
from app.runtime.operation_receipts import OperationError

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


@router.patch("/{project_id}/story/edits", response_model=GalgameStoryDocumentOut)
async def patch_story_edits(
    session: SessionDep,
    project_id: str,
    body: GalgameStoryEditsPatchIn,
) -> GalgameStoryDocumentOut:
    try:
        return await GalgameStoryPatches(session).patch_edits(project_id, body)
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
    workspace_id: WorkspaceDep,
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
        return await GalgameStoryMigrations(session, workspace_id).import_legacy(
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
async def get_story_report(
    session: SessionDep, workspace_id: WorkspaceDep, project_id: str
) -> GalgameStoryRouteReportOut:
    try:
        return await GalgameReadiness(session, get_settings(), workspace_id).report(project_id)
    except (
        GalgameWorkshopProjectNotFoundError,
        GalgameStoryDocumentNotFoundError,
    ) as exc:
        raise _not_found(exc) from None
    except GalgameStoryDocumentInvalidError as exc:
        raise _invalid_story(exc) from None


async def _mapped_operations(operation):
    try:
        return await operation
    except OperationError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
    except ValidationError as exc:
        raise HTTPException(
            422, {"code": "invalid_operation_result", "errors": exc.errors(include_context=False)}
        ) from None
    except (GalgameStoryDocumentNotFoundError, GalgameWorkshopProjectNotFoundError) as exc:
        raise HTTPException(404, {"code": "not_found", "message": str(exc)}) from None
    except GalgameStoryDocumentInvalidError as exc:
        raise HTTPException(422, {"code": "invalid_story", "message": str(exc)}) from None


@router.post(
    "/{project_id}/story/operations",
    response_model=GalgameStoryDocumentOut,
)
async def apply_story_operations(
    project_id: str, body: GalgameOperationsIn, session: SessionDep, workspace_id: WorkspaceDep
):
    return await _mapped_operations(galgame_operations(session, workspace_id, project_id, body))
