"""Keep external binding operations on Integrations' request-scoped read port."""

import json

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.external_sync.binding import bind_note
from app.apps.thought_workshop.external_sync.records import ArticleSyncRecords
from app.apps.thought_workshop.external_sync.schemas import ArticleBindingInput, ArticleBindingOut
from app.apps.thought_workshop.http_bindings import SessionDep
from app.deps import OwnerDep, StudioAuth
from app.integrations.external.contracts import ExternalError
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.external_sync import ExternalBindingTarget, ExternalRead

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


class BindingReads:
    def __init__(self, request, note_id):
        self.request, self.note_id = request, note_id
        self.client = request.app.state.thought_sync_reads
        self.revision = None

    async def execute(self, connection, body, output):
        request = self.request
        path = body.path(self.note_id, connection)
        grant = RequestGrant(
            "thought",
            "thought.external-sync.read",
            request.method,
            request.url.path,
            "integrations",
            "POST",
            path,
        )
        try:
            token = await self.client.authorize_request(request.state.service_assertion, grant)
            async with self.client.client.stream(
                "POST",
                "http://integrations:8080" + path,
                headers={"X-Fpl-Context": token},
                json=body.model_dump(mode="json"),
            ) as response:
                payload = bytearray()
                async for chunk in response.aiter_bytes():
                    payload.extend(chunk)
                    if len(payload) > 32 * 1024:
                        raise ValueError("external target response too large")
                if response.status_code in {401, 403, 404, 409, 422, 502, 503}:
                    error = json.loads(payload)
                    raise ExternalError(
                        str(error.get("detail") or "同步连接读取失败"),
                        response.status_code,
                        str(error.get("code") or "external_connection_error"),
                    )
                if response.status_code != 200:
                    raise ValueError("external target response invalid")
                return output.model_validate_json(payload)
        except CapabilityDenied as exc:
            raise ExternalError("同步连接授权已失效", exc.status, "authorization_revoked") from None
        except (CapabilityUnavailable, httpx.HTTPError, ValueError, AttributeError):
            raise ExternalError(
                "同步连接暂不可用", 503, "external_connection_unavailable"
            ) from None

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
