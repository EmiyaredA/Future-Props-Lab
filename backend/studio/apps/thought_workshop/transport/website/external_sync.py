import httpx
from fastapi import APIRouter, HTTPException, Request

from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.external_sync.schemas import (
    ArticleBindingInput,
    ArticleBindingOut,
    ArticlePreviewInput,
    ArticleSyncPreview,
    ArticleSyncReconcile,
    ArticleSyncReconcileOut,
    ArticleSyncSubmit,
    ArticleSyncTaskOut,
)
from studio.apps.thought_workshop.http_bindings import SessionDep
from studio.assembly.http_dependencies import OwnerDep, StudioAuth
from studio.contracts.integrations.external_documents import ExternalError

router = APIRouter(
    prefix="/thought-workshop/notes/{note_id}/external-sync", tags=["thought-workshop"]
)


def use_case(request, session, owner_user_id, principal):
    try:
        return request.app.state.article_sync(session, owner_user_id, principal)
    except ExternalError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


async def call(operation):
    try:
        return await operation
    except (ExternalError, ThoughtError) as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
    except httpx.HTTPError:
        raise HTTPException(502, "连接飞书失败，请稍后重新预览或核对任务") from None


@router.put("/binding", response_model=ArticleBindingOut)
async def bind(
    request: Request,
    note_id: str,
    body: ArticleBindingInput,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
):
    return await call(use_case(request, session, owner_user_id, principal).bind(note_id, body))


@router.post("/preview", response_model=ArticleSyncPreview)
async def preview(
    request: Request,
    note_id: str,
    body: ArticlePreviewInput,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
):
    return await call(use_case(request, session, owner_user_id, principal).preview(note_id, body))


@router.post("/tasks", response_model=ArticleSyncTaskOut, status_code=202)
async def submit(
    request: Request,
    note_id: str,
    body: ArticleSyncSubmit,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
):
    return await call(use_case(request, session, owner_user_id, principal).submit(note_id, body))


@router.post("/tasks/{task_id}/reconcile", response_model=ArticleSyncReconcileOut)
async def reconcile(
    request: Request,
    note_id: str,
    task_id: str,
    body: ArticleSyncReconcile,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
):
    return await call(
        use_case(request, session, owner_user_id, principal).reconcile(note_id, task_id, body)
    )
