"""Published project and initial Story operations for the Galgame owner."""

from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError

from app.apps.galgame_workshop.schemas import (
    GalgameStoryDialoguePatchIn,
    GalgameStoryDialoguePatchOut,
    GalgameStoryDocumentOut,
    GalgameStoryDocumentPutIn,
    GalgameStoryEditsPatchIn,
    GalgameStorySnapshotOut,
    GalgameStorySnapshotRestoreIn,
    GalgameStoryStageExpressionPatchIn,
    GalgameStoryStageExpressionPatchOut,
    GalgameWorkshopProjectCreateIn,
    GalgameWorkshopProjectListOut,
    GalgameWorkshopProjectOut,
)
from app.apps.galgame_workshop.schemas.operations import GalgameOperationsIn
from app.runtime.operation_receipts import OperationError
from fpl_runtime.http_dependencies import OwnerDep, SessionDep
from fpl_runtime.project_errors import ProjectResourceError
from fpl_runtime.reference_runtime import reference_lifespan

from .projects import Projects
from .story_writes import PREFIX, StoryWrites

router = APIRouter(prefix=PREFIX, tags=["galgame-workshop"], lifespan=reference_lifespan)


def story_writes(request, session, owner):
    return StoryWrites(
        session, owner, request.app.state.reference_mutations, request.state.service_assertion
    )


@router.get("", response_model=GalgameWorkshopProjectListOut)
async def list_projects(session: SessionDep, owner_user_id: OwnerDep):
    return await Projects(session, owner_user_id).list()


@router.post("", response_model=GalgameWorkshopProjectOut)
async def create_project(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    body: GalgameWorkshopProjectCreateIn,
):
    return await story_writes(request, session, owner_user_id).create_project(body)


@router.get("/{project_id}", response_model=GalgameWorkshopProjectOut)
async def get_project(session: SessionDep, owner_user_id: OwnerDep, project_id: str):
    return await Projects(session, owner_user_id).get(project_id)


@router.get("/{project_id}/story", response_model=GalgameStoryDocumentOut)
async def get_story(session: SessionDep, owner_user_id: OwnerDep, project_id: str):
    return await Projects(session, owner_user_id).story(project_id)


@router.put("/{project_id}/story", response_model=GalgameStoryDocumentOut)
async def put_story(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: GalgameStoryDocumentPutIn,
):
    return await story_writes(request, session, owner_user_id).put(project_id, body)


@router.patch("/{project_id}/story/edits", response_model=GalgameStoryDocumentOut)
async def patch_story_edits(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: GalgameStoryEditsPatchIn,
):
    return await story_writes(request, session, owner_user_id).patch_edits(project_id, body)


@router.patch("/{project_id}/story/dialogue", response_model=GalgameStoryDialoguePatchOut)
async def patch_story_dialogue(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: GalgameStoryDialoguePatchIn,
):
    return await story_writes(request, session, owner_user_id).patch_dialogue(project_id, body)


@router.patch(
    "/{project_id}/story/stage-expression", response_model=GalgameStoryStageExpressionPatchOut
)
async def patch_story_stage_expression(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: GalgameStoryStageExpressionPatchIn,
):
    return await story_writes(request, session, owner_user_id).patch_stage_expression(
        project_id, body
    )


@router.post("/{project_id}/story/operations", response_model=GalgameStoryDocumentOut)
async def apply_story_operations(
    request: Request,
    project_id: str,
    body: GalgameOperationsIn,
    session: SessionDep,
    owner_user_id: OwnerDep,
):
    try:
        return await story_writes(request, session, owner_user_id).apply_operations(
            project_id, body
        )
    except OperationError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
    except ValidationError as exc:
        raise HTTPException(
            422, {"code": "invalid_operation_result", "errors": exc.errors(include_context=False)}
        ) from None
    except ProjectResourceError as exc:
        if exc.code == "invalid_story_document":
            raise HTTPException(422, {"code": "invalid_story", "message": str(exc)}) from None
        raise


@router.get("/{project_id}/story/snapshots", response_model=list[GalgameStorySnapshotOut])
async def list_story_snapshots(session: SessionDep, project_id: str, owner_user_id: OwnerDep):
    return await Projects(session, owner_user_id).snapshots(project_id)


@router.post(
    "/{project_id}/story/snapshots/{snapshot_id}/restore",
    response_model=GalgameStoryDocumentOut,
)
async def restore_story_snapshot(
    request: Request,
    session: SessionDep,
    project_id: str,
    snapshot_id: str,
    body: GalgameStorySnapshotRestoreIn,
    owner_user_id: OwnerDep,
):
    return await story_writes(request, session, owner_user_id).restore_snapshot(
        project_id, snapshot_id, body.expected_story_revision
    )
