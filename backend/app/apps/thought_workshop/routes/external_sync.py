import httpx
from fastapi import APIRouter, HTTPException, Query

from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.external_sync.schemas import (
    ArticleBindingInput,
    ArticleBindingOut,
    ArticlePreviewInput,
    ArticleSyncPreview,
    ArticleSyncReconcile,
    ArticleSyncReconcileOut,
    ArticleSyncState,
    ArticleSyncSubmit,
    ArticleSyncTaskOut,
)
from app.apps.thought_workshop.external_sync.use_cases import ArticleSync
from app.apps.thought_workshop.http_bindings import SessionDep
from app.deps import OwnerDep, StudioAuth
from app.integrations.external.contracts import ExternalError

router = APIRouter(
    prefix="/thought-workshop/notes/{note_id}/external-sync", tags=["thought-workshop"]
)


def use_case(session, owner_user_id, principal):
    try:
        return ArticleSync(session, owner_user_id, principal)
    except ExternalError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


async def call(operation):
    try:
        return await operation
    except (ExternalError, ThoughtError) as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
    except httpx.HTTPError:
        raise HTTPException(502, "连接飞书失败，请稍后重新预览或核对任务") from None


@router.get("", response_model=ArticleSyncState)
async def state(note_id: str, principal: StudioAuth, session: SessionDep, owner_user_id: OwnerDep):
    return await call(use_case(session, owner_user_id, principal).state(note_id))


@router.put("/binding", response_model=ArticleBindingOut)
async def bind(
    note_id: str,
    body: ArticleBindingInput,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
):
    return await call(use_case(session, owner_user_id, principal).bind(note_id, body))


@router.delete("/binding", status_code=204)
async def unbind(
    note_id: str,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
    expected_revision: int = Query(ge=0),
):
    await call(use_case(session, owner_user_id, principal).unbind(note_id, expected_revision))


@router.post("/preview", response_model=ArticleSyncPreview)
async def preview(
    note_id: str,
    body: ArticlePreviewInput,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
):
    return await call(use_case(session, owner_user_id, principal).preview(note_id, body))


@router.post("/tasks", response_model=ArticleSyncTaskOut, status_code=202)
async def submit(
    note_id: str,
    body: ArticleSyncSubmit,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
):
    return await call(use_case(session, owner_user_id, principal).submit(note_id, body))


@router.get("/tasks/{task_id}", response_model=ArticleSyncTaskOut)
async def task(
    note_id: str,
    task_id: str,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
):
    return await call(use_case(session, owner_user_id, principal).detail(note_id, task_id))


@router.post("/tasks/{task_id}/reconcile", response_model=ArticleSyncReconcileOut)
async def reconcile(
    note_id: str,
    task_id: str,
    body: ArticleSyncReconcile,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
):
    return await call(use_case(session, owner_user_id, principal).reconcile(note_id, task_id, body))
