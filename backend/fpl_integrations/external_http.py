"""Fixed private article-sync protocol; callers cannot select an owner or get credentials."""

from uuid import UUID

import httpx
import jwt
from fastapi import APIRouter, HTTPException, Request

from app.capabilities.identity.permissions import effective_permissions
from app.integrations.external.contracts import ExternalError
from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.external_sync import (
    ExternalClose,
    ExternalRead,
    ExternalStep,
    ExternalStepEvidence,
)
from fpl_runtime.integration_client import IntegrationAuthorizationUnavailable

router = APIRouter(prefix="/_internal/v1/external-sync", include_in_schema=False)


def source(request):
    if request.headers.get("origin") or request.headers.get("cookie"):
        raise HTTPException(403, "external_sync_grant_required")
    try:
        actor = verify_context(
            request.headers.get(HEADER, ""),
            service="integrations",
            method="POST",
            path=request.url.path,
            public_key=request.app.state.identity_public_key,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "external_sync_grant_required") from None
    if actor.purpose != "studio" or "configuration.manage" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "external_sync_permission_required")
    return actor


async def intent_check(request, intent_id, actor):
    try:
        decision = await request.app.state.integration_intents.check(intent_id)
    except IntegrationAuthorizationUnavailable:
        raise ExternalError("同步授权暂不可用", 503, "authorization_unavailable") from None
    if decision.actor != actor or decision.scope.kind != "external.sync":
        raise ExternalError("同步授权范围不一致", 403, "scope_mismatch")
    if not decision.allowed:
        raise ExternalError("原同步授权已经撤销", 403, "authorization_revoked")
    return decision.scope


async def forward_check(request):
    active = await request.app.state.identity.status(
        assertion=request.headers[HEADER], method="POST", path=request.url.path
    )
    if active is None:
        raise ExternalError("同步授权暂不可用", 503, "authorization_unavailable")
    if not active:
        raise ExternalError("同步授权已经撤销", 403, "authorization_revoked")


@router.post("/reads/{note_id}/{connection_id}/{fingerprint}")
async def read(
    request: Request, note_id: str, connection_id: str, fingerprint: str, body: ExternalRead
):
    actor = source(request)
    if fingerprint != body.fingerprint() or body.path(note_id, connection_id) != request.url.path:
        raise HTTPException(422, "external_sync_input_mismatch")
    return await request.app.state.external_reads.execute(
        actor.user_id, connection_id, body, lambda: forward_check(request)
    )


@router.post("/tasks/{intent_id}/reads/{fingerprint}")
async def task_read(
    request: Request, intent_id: UUID, fingerprint: str, body: ExternalRead | ExternalStepEvidence
):
    actor = source(request)
    if fingerprint != body.fingerprint() or body.task_path(intent_id) != request.url.path:
        raise HTTPException(422, "external_sync_input_mismatch")
    scope = await intent_check(request, intent_id, actor)
    if isinstance(body, ExternalStepEvidence):
        return await request.app.state.external_steps.step_proof(actor, scope, intent_id, body)
    if body.op == "checkpoint" and body.connection_revision is None:
        return await request.app.state.external_steps.progress(actor, scope, intent_id)
    return await request.app.state.external_reads.execute(
        actor.user_id,
        scope.connection_id,
        body,
        lambda: intent_check(request, intent_id, actor),
        scope=scope,
    )


@router.post("/tasks/{intent_id}/steps/{step_id}/{fingerprint}")
async def step(
    request: Request, intent_id: UUID, step_id: UUID, fingerprint: str, body: ExternalStep
):
    actor = source(request)
    if (
        body.step_id != step_id
        or fingerprint != body.fingerprint()
        or body.path(intent_id) != request.url.path
    ):
        raise HTTPException(422, "external_sync_input_mismatch")
    scope = await intent_check(request, intent_id, actor)
    try:
        return await request.app.state.external_steps.execute(
            actor, scope, intent_id, body, lambda: intent_check(request, intent_id, actor)
        )
    except (httpx.HTTPError, OSError):
        raise ExternalError(
            "外部同步响应未知，请核对远端结果；不会自动重放", 502, "uncertain_write"
        ) from None


@router.post("/closed/{note_id}/{task_id}/{fingerprint}")
async def close(
    request: Request, note_id: str, task_id: UUID, fingerprint: str, body: ExternalClose
):
    actor = source(request)
    if (
        body.note_id != note_id
        or body.task_id != task_id
        or fingerprint != body.fingerprint()
        or body.path() != request.url.path
    ):
        raise HTTPException(422, "external_sync_input_mismatch")
    await forward_check(request)
    return await request.app.state.external_steps.close(actor.user_id, body)
