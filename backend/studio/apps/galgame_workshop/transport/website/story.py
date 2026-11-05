from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import ValidationError

from studio.apps.galgame_workshop.errors import (
    GalgameStoryDocumentInvalidError,
    GalgameStoryDocumentNotFoundError,
    GalgameWorkshopProjectNotFoundError,
)
from studio.apps.galgame_workshop.readiness import GalgameReadiness
from studio.apps.galgame_workshop.schemas import (
    GalgameStoryDialoguePatchIn,
    GalgameStoryDialoguePatchOut,
    GalgameStoryDocumentOut,
    GalgameStoryDocumentPutIn,
    GalgameStoryEditsPatchIn,
    GalgameStoryRouteReportOut,
    GalgameStoryStageExpressionPatchIn,
    GalgameStoryStageExpressionPatchOut,
)
from studio.apps.galgame_workshop.schemas.operations import GalgameOperationsIn
from studio.apps.galgame_workshop.story.migration_inventory import (
    MAX_STORY_IMPORT_BYTES,
    decode_legacy_story,
)
from studio.apps.galgame_workshop.story.operations import apply_operations as galgame_operations
from studio.apps.galgame_workshop.story.story import GalgameStoryDocuments
from studio.apps.galgame_workshop.story.story_migrations import GalgameStoryMigrations
from studio.apps.galgame_workshop.story.story_patches import GalgameStoryPatches
from studio.apps.galgame_workshop.transport.website._shared import _invalid_story, _not_found
from studio.assembly.http_dependencies import OwnerDep, SessionDep
from studio.config.settings import get_settings
from studio.runtime.database.operation_receipts import OperationError

router = APIRouter()


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
    owner_user_id: OwnerDep,
    project_id: str,
    expected_revision: Annotated[int, Form(alias="expectedRevision", ge=0)],
    file: Annotated[UploadFile, File()],
) -> GalgameStoryDocumentOut:
    try:
        document = decode_legacy_story(await file.read(MAX_STORY_IMPORT_BYTES + 1))
        return await GalgameStoryMigrations(session, owner_user_id).import_legacy(
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
    session: SessionDep, owner_user_id: OwnerDep, project_id: str
) -> GalgameStoryRouteReportOut:
    try:
        return await GalgameReadiness(session, get_settings(), owner_user_id).report(project_id)
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
    project_id: str, body: GalgameOperationsIn, session: SessionDep, owner_user_id: OwnerDep
):
    return await _mapped_operations(galgame_operations(session, owner_user_id, project_id, body))
