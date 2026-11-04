"""Published project and document operations with service-local transactions."""

from fastapi import APIRouter, Query

from app.deps import OwnerDep, SessionDep

from ..projects import MotionInvalid, MotionNotFound, MotionProjects, MotionUnavailable
from ..schemas import (
    DocumentOut,
    OperationBatchIn,
    ProjectCreateIn,
    ProjectListOut,
    ProjectOut,
    ProjectPatchIn,
)
from .errors import _error

router = APIRouter()


@router.get("/projects", response_model=ProjectListOut)
async def list_projects(session: SessionDep, owner_user_id: OwnerDep) -> ProjectListOut:
    return await MotionProjects(session, owner_user_id).list()


@router.post("/projects", response_model=ProjectOut)
async def create_project(
    session: SessionDep, owner_user_id: OwnerDep, body: ProjectCreateIn
) -> ProjectOut:
    try:
        return await MotionProjects(session, owner_user_id).create(body)
    except (MotionNotFound, MotionUnavailable, MotionInvalid) as exc:
        raise _error(exc) from None


@router.get("/projects/{project_id}", response_model=ProjectOut)
async def get_project(session: SessionDep, owner_user_id: OwnerDep, project_id: str) -> ProjectOut:
    try:
        return await MotionProjects(session, owner_user_id).get(project_id)
    except MotionNotFound as exc:
        raise _error(exc) from None


@router.patch("/projects/{project_id}", response_model=ProjectOut)
async def patch_project(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str, body: ProjectPatchIn
) -> ProjectOut:
    try:
        return await MotionProjects(session, owner_user_id).patch(project_id, body)
    except MotionNotFound as exc:
        raise _error(exc) from None


@router.get("/projects/{project_id}/document", response_model=DocumentOut)
async def get_document(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str
) -> DocumentOut:
    try:
        return await MotionProjects(session, owner_user_id).document(project_id)
    except MotionNotFound as exc:
        raise _error(exc) from None


@router.post("/projects/{project_id}/document/operations", response_model=DocumentOut)
async def edit_document(
    session: SessionDep, owner_user_id: OwnerDep, project_id: str, body: OperationBatchIn
) -> DocumentOut:
    try:
        return await MotionProjects(session, owner_user_id).apply(project_id, body)
    except (MotionInvalid, MotionNotFound, MotionUnavailable) as exc:
        raise _error(exc) from None


@router.delete("/projects/{project_id}")
async def delete_project(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    expected_revision: int = Query(alias="expectedRevision", ge=0),
) -> dict[str, bool]:
    try:
        await MotionProjects(session, owner_user_id).delete(project_id, expected_revision)
    except (MotionNotFound, MotionUnavailable, MotionInvalid) as exc:
        raise _error(exc) from None
    return {"deleted": True}
