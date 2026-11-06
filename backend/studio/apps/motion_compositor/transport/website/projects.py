"""Published project and document operations with service-local transactions."""

from fastapi import APIRouter, Query

from studio.apps.motion_compositor.projects import (
    MotionInvalid,
    MotionNotFound,
    MotionUnavailable,
)
from studio.apps.motion_compositor.schemas import (
    DocumentOut,
    OperationBatchIn,
    ProjectCreateIn,
    ProjectListOut,
    ProjectOut,
    ProjectPatchIn,
)
from studio.apps.motion_compositor.transport.dependencies import MotionDep
from studio.apps.motion_compositor.transport.website.errors import _error

router = APIRouter()


@router.get("/projects", response_model=ProjectListOut)
async def list_projects(projects: MotionDep) -> ProjectListOut:
    return await projects.list()


@router.post("/projects", response_model=ProjectOut)
async def create_project(projects: MotionDep, body: ProjectCreateIn) -> ProjectOut:
    try:
        return await projects.create(body)
    except (MotionNotFound, MotionUnavailable, MotionInvalid) as exc:
        raise _error(exc) from None


@router.get("/projects/{project_id}", response_model=ProjectOut)
async def get_project(projects: MotionDep, project_id: str) -> ProjectOut:
    try:
        return await projects.get(project_id)
    except MotionNotFound as exc:
        raise _error(exc) from None


@router.patch("/projects/{project_id}", response_model=ProjectOut)
async def patch_project(projects: MotionDep, project_id: str, body: ProjectPatchIn) -> ProjectOut:
    try:
        return await projects.patch(project_id, body)
    except MotionNotFound as exc:
        raise _error(exc) from None


@router.get("/projects/{project_id}/document", response_model=DocumentOut)
async def get_document(projects: MotionDep, project_id: str) -> DocumentOut:
    try:
        return await projects.document(project_id)
    except MotionNotFound as exc:
        raise _error(exc) from None


@router.post("/projects/{project_id}/document/operations", response_model=DocumentOut)
async def edit_document(
    projects: MotionDep, project_id: str, body: OperationBatchIn
) -> DocumentOut:
    try:
        return await projects.apply(project_id, body)
    except (MotionInvalid, MotionNotFound, MotionUnavailable) as exc:
        raise _error(exc) from None


@router.delete("/projects/{project_id}")
async def delete_project(
    projects: MotionDep,
    project_id: str,
    expected_revision: int = Query(alias="expectedRevision", ge=0),
) -> dict[str, bool]:
    try:
        await projects.delete(project_id, expected_revision)
    except (MotionNotFound, MotionUnavailable, MotionInvalid) as exc:
        raise _error(exc) from None
    return {"deleted": True}
