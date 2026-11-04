"""Published project and initial canvas operations for the Visual owner."""

from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError

from app.apps.visual_workshop.canvas_documents import VisualCanvasError
from app.apps.visual_workshop.schemas.operations import VisualOperationsIn
from app.apps.visual_workshop.schemas.workshop import (
    VisualCanvasDocumentOut,
    VisualCanvasDocumentPutIn,
    VisualWorkshopProjectCreateIn,
    VisualWorkshopProjectListOut,
    VisualWorkshopProjectOut,
    VisualWorkshopProjectPatchIn,
)
from app.capabilities.asset_store.schemas.project_snapshots import ProjectFolderOpenOut
from app.runtime.operation_receipts import OperationError
from fpl_runtime.http_dependencies import OwnerDep, SessionDep, StudioAuth
from fpl_runtime.project_reveal_http import (
    open_verified_project_folder,
    require_local_project_request,
)
from fpl_runtime.reference_runtime import reference_lifespan

from .canvas_writes import PREFIX, CanvasWrites
from .projects import Projects

router = APIRouter(prefix=PREFIX, tags=["visual-workshop"], lifespan=reference_lifespan)


def canvas_writes(request, session, owner):
    return CanvasWrites(
        session, owner, request.app.state.reference_mutations, request.state.service_assertion
    )


@router.get("", response_model=VisualWorkshopProjectListOut)
async def list_projects(session: SessionDep, owner_user_id: OwnerDep):
    return await Projects(session, owner_user_id).list()


@router.post("", response_model=VisualWorkshopProjectOut)
async def create_project(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    body: VisualWorkshopProjectCreateIn,
):
    return await canvas_writes(request, session, owner_user_id).create_project(body)


@router.get("/{project_id}", response_model=VisualWorkshopProjectOut)
async def get_project(session: SessionDep, owner_user_id: OwnerDep, project_id: str):
    return await Projects(session, owner_user_id).get(project_id)


@router.patch("/{project_id}", response_model=VisualWorkshopProjectOut)
async def patch_project(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: VisualWorkshopProjectPatchIn,
):
    return await Projects(session, owner_user_id).patch(project_id, body)


@router.get("/{project_id}/canvas", response_model=VisualCanvasDocumentOut)
async def get_canvas(session: SessionDep, owner_user_id: OwnerDep, project_id: str):
    return await Projects(session, owner_user_id).canvas(project_id)


@router.put("/{project_id}/canvas", response_model=VisualCanvasDocumentOut)
async def put_canvas(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: VisualCanvasDocumentPutIn,
):
    try:
        return await canvas_writes(request, session, owner_user_id).put(project_id, body)
    except VisualCanvasError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.post("/{project_id}/canvas/operations", response_model=VisualCanvasDocumentOut)
async def apply_canvas_operations(
    request: Request,
    project_id: str,
    body: VisualOperationsIn,
    session: SessionDep,
    owner_user_id: OwnerDep,
):
    try:
        return await canvas_writes(request, session, owner_user_id).apply_operations(
            project_id, body
        )
    except (OperationError, VisualCanvasError) as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
    except ValidationError as exc:
        raise HTTPException(
            422, {"code": "invalid_operation_result", "errors": exc.errors(include_context=False)}
        ) from None


@router.post("/{project_id}/open-folder", response_model=ProjectFolderOpenOut)
async def reveal_project_folder(
    request: Request, principal: StudioAuth, session: SessionDep, project_id: str
) -> ProjectFolderOpenOut:
    require_local_project_request(request, principal)
    await Projects(session, principal.user_id).row(project_id)
    return await open_verified_project_folder(request, session, "visual-workshop", project_id)
