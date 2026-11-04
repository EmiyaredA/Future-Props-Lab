"""Shared HTTP operations for Thought-owned external sync records."""

from fastapi import APIRouter, HTTPException, Query

from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.external_sync.records import ArticleSyncRecords
from app.apps.thought_workshop.external_sync.schemas import (
    ArticleSyncState,
    ArticleSyncTaskOut,
)
from app.apps.thought_workshop.http_bindings import SessionDep
from app.deps import OwnerDep, StudioAuth
from app.integrations.external.contracts import ExternalError

router = APIRouter(
    prefix="/thought-workshop/notes/{note_id}/external-sync", tags=["thought-workshop"]
)


def use_case(session, owner_user_id, principal):
    try:
        return ArticleSyncRecords(session, owner_user_id, principal)
    except ExternalError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


async def call(operation):
    try:
        return await operation
    except (ExternalError, ThoughtError) as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.get("", response_model=ArticleSyncState)
async def state(note_id: str, principal: StudioAuth, session: SessionDep, owner_user_id: OwnerDep):
    return await call(use_case(session, owner_user_id, principal).state(note_id))


@router.delete("/binding", status_code=204)
async def unbind(
    note_id: str,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
    expected_revision: int = Query(ge=0),
):
    await call(use_case(session, owner_user_id, principal).unbind(note_id, expected_revision))


@router.get("/tasks/{task_id}", response_model=ArticleSyncTaskOut)
async def task(
    note_id: str,
    task_id: str,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
):
    return await call(use_case(session, owner_user_id, principal).detail(note_id, task_id))
