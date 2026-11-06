"""Published presentation project CRUD and operation-batch HTTP routes."""

from fastapi import APIRouter, HTTPException, Query
from pydantic import ValidationError

from studio.apps.presentation_workshop.operations import apply_operations as presentation_operations
from studio.apps.presentation_workshop.projects import PresentationError
from studio.apps.presentation_workshop.schemas.document import (
    PresentationProjectIn,
    PresentationProjectList,
    PresentationProjectOut,
    PresentationProjectPut,
)
from studio.apps.presentation_workshop.schemas.operations import PresentationOperationsIn
from studio.apps.presentation_workshop.transport.website.dependencies import PresentationDep
from studio.runtime.database.operation_receipts import OperationError

router = APIRouter()


def mapped(exc: PresentationError | OperationError):
    return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})


async def mapped_operation(operation):
    try:
        return await operation
    except (OperationError, PresentationError) as exc:
        raise mapped(exc) from None
    except ValidationError as exc:
        raise HTTPException(
            422, {"code": "invalid_operation_result", "errors": exc.errors(include_context=False)}
        ) from None


@router.get("/projects", response_model=PresentationProjectList)
async def list_projects(
    projects: PresentationDep,
    query: str = Query("", max_length=120),
    offset: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=100),
):
    return await projects.list(query, offset, limit)


@router.post("/projects", response_model=PresentationProjectOut)
async def create_project(projects: PresentationDep, body: PresentationProjectIn):
    try:
        return await projects.create(body)
    except PresentationError as exc:
        raise mapped(exc) from None


@router.get("/projects/{project_id}", response_model=PresentationProjectOut)
async def get_project(projects: PresentationDep, project_id: str):
    try:
        return await projects.get(project_id)
    except PresentationError as exc:
        raise mapped(exc) from None


@router.put("/projects/{project_id}", response_model=PresentationProjectOut)
async def put_project(projects: PresentationDep, project_id: str, body: PresentationProjectPut):
    try:
        return await projects.put(project_id, body)
    except PresentationError as exc:
        raise mapped(exc) from None


@router.delete("/projects/{project_id}")
async def delete_project(
    projects: PresentationDep,
    project_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await projects.delete(project_id, expected_revision)
        return {"deleted": True}
    except PresentationError as exc:
        raise mapped(exc) from None


@router.post("/projects/{project_id}/operations", response_model=PresentationProjectOut)
async def apply_presentation_operations(
    project_id: str, body: PresentationOperationsIn, projects: PresentationDep
):
    return await mapped_operation(presentation_operations(projects, project_id, body))
