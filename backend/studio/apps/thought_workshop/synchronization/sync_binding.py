"""Keep external binding operations on Integrations' request-scoped read port."""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from app.deps import OwnerDep, StudioAuth
from app.integrations.external.contracts import ExternalError, RemoteDocument
from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.external_sync.binding import bind_note
from studio.apps.thought_workshop.external_sync.preview import preview_note
from studio.apps.thought_workshop.external_sync.records import ArticleSyncRecords
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
from studio.apps.thought_workshop.synchronization.sync_reconcile import reconcile_task
from studio.apps.thought_workshop.synchronization.sync_submit import submit_task
from studio.apps.thought_workshop.synchronization.sync_transport import (
    MAX_SNAPSHOT,
    OBJECT,
    post_sync,
)
from studio.contracts.identity.delegation import RequestGrant
from studio.contracts.integrations.external_sync import (
    ExternalBindingTarget,
    ExternalClose,
    ExternalDocumentSnapshot,
    ExternalRead,
)
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable

router = APIRouter(
    prefix="/thought-workshop/notes/{note_id}/external-sync", tags=["thought-workshop"]
)


class ConnectionVersion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    revision: int = Field(ge=0, strict=True)
    enabled: bool


class ResolvedDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document_id: str = Field(pattern=r"^[A-Za-z0-9]{1,200}$")
    url: str = Field(max_length=2048)


class WritePermission(BaseModel):
    model_config = ConfigDict(extra="forbid")
    can_write: bool


class BindingReads:
    def __init__(self, request, note_id):
        self.request, self.note_id = request, note_id
        self.client = request.app.state.thought_sync_reads
        self.revision = None

    async def execute(self, connection, body, output, *, maximum_bytes=32 * 1024):
        try:
            path = body.path(self.note_id, connection)
        except ValueError:
            raise ExternalError("同步连接不存在", 404, "not_found") from None
        return await self.forward(
            path, "thought.external-sync.read", body, output, maximum_bytes=maximum_bytes
        )

    async def forward(self, path, purpose, body, output, *, maximum_bytes=32 * 1024):
        request = self.request
        grant = RequestGrant(
            "thought",
            purpose,
            request.method,
            request.url.path,
            "integrations",
            "POST",
            path,
        )
        try:
            token = await self.client.authorize_request(request.state.service_assertion, grant)
        except CapabilityDenied as exc:
            raise ExternalError("同步连接授权已失效", exc.status, "authorization_revoked") from None
        except CapabilityUnavailable:
            raise ExternalError(
                "同步连接暂不可用", 503, "external_connection_unavailable"
            ) from None
        return await post_sync(
            self.client.client, path, token, body, output, maximum_bytes=maximum_bytes
        )

    async def close_task(self, task_id):
        try:
            body = ExternalClose(note_id=self.note_id, task_id=task_id)
        except ValueError:
            raise ExternalError("同步任务不存在", 404, "not_found") from None
        result = await self.forward(body.path(), "thought.external-sync.close", body, OBJECT)
        if result != {"closed": True}:
            raise ExternalError("远端关闭回执无效", 503, "external_close_unconfirmed")

    async def get(self, connection):
        result = await self.execute(connection, ExternalRead(op="get"), ConnectionVersion)
        self.revision = result.revision
        return result

    async def resolve_document(self, connection, url):
        result = await self.execute(
            connection,
            ExternalRead(op="resolve_document", url=url, connection_revision=self.revision),
            ResolvedDocument,
        )
        return result.document_id, result.url

    async def target(self, connection, url):
        return await self.execute(
            connection,
            ExternalRead(op="binding_target", url=url, connection_revision=self.revision),
            ExternalBindingTarget,
        )

    async def require_enabled(self, connection, *, expected_revision):
        return await self.execute(
            connection,
            ExternalRead(op="require_enabled", connection_revision=expected_revision),
            ConnectionVersion,
        )

    async def read_document(self, connection, revision, document_id):
        value = await self.execute(
            connection,
            ExternalRead(op="read", document_id=document_id, connection_revision=revision),
            ExternalDocumentSnapshot,
            maximum_bytes=MAX_SNAPSHOT,
        )
        remote = RemoteDocument(
            value.document_id, value.title, value.revision, value.blocks, value.root_ids
        )
        if remote.document_id != document_id or remote.snapshot() != value.model_dump():
            raise ExternalError("远端文档快照与读取范围不一致", 503, "external_snapshot_invalid")
        return remote

    async def preview_target(self, connection, document_id):
        revision = (await self.get(connection)).revision
        remote = await self.read_document(connection, revision, document_id)
        permission = await self.execute(
            connection,
            ExternalRead(op="can_write", document_id=document_id, connection_revision=revision),
            WritePermission,
        )
        if not permission.can_write:
            raise ExternalError("目标文档不可编辑", 403)
        return revision, remote


@router.put("/binding", response_model=ArticleBindingOut)
async def bind(
    note_id: str,
    body: ArticleBindingInput,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
    request: Request,
):
    try:
        return await bind_note(
            ArticleSyncRecords(session, owner_user_id, principal),
            BindingReads(request, note_id),
            note_id,
            body,
        )
    except (ExternalError, ThoughtError) as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.post("/preview", response_model=ArticleSyncPreview)
async def preview(
    note_id: str,
    body: ArticlePreviewInput,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
    request: Request,
):
    try:
        return await preview_note(
            ArticleSyncRecords(session, owner_user_id, principal),
            BindingReads(request, note_id).preview_target,
            note_id,
            body,
        )
    except (ExternalError, ThoughtError) as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.post("/tasks", response_model=ArticleSyncTaskOut, status_code=202)
async def submit(
    note_id: str,
    body: ArticleSyncSubmit,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
    request: Request,
):
    try:
        return await submit_task(
            ArticleSyncRecords(session, owner_user_id, principal),
            BindingReads(request, note_id),
            request,
            note_id,
            body,
        )
    except (ExternalError, ThoughtError) as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.post("/tasks/{task_id}/reconcile", response_model=ArticleSyncReconcileOut)
async def reconcile(
    note_id: str,
    task_id: str,
    body: ArticleSyncReconcile,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
    request: Request,
):
    try:
        return await reconcile_task(
            ArticleSyncRecords(session, owner_user_id, principal),
            BindingReads(request, note_id),
            request.app.state,
            note_id,
            task_id,
            body,
        )
    except (ExternalError, ThoughtError) as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
