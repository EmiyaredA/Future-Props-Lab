"""Fixed authenticated Integration validation capacity routes."""

from typing import Literal
from uuid import UUID

import jwt
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict

from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.integration_client import IntegrationAuthorizationUnavailable
from fpl_runtime.integration_intents import digest

from .integration_capacity import acquire_capacity, release_capacity


class ReleaseInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    outcome: str


router = APIRouter(prefix="/_internal/v1/integration-capacity", include_in_schema=False)


async def principal(request, intent_id, operation):
    if request.headers.get("origin") or request.headers.get("cookie"):
        raise HTTPException(403, "integration_capacity_grant_required")
    try:
        actor = verify_context(
            request.headers.get(HEADER, ""),
            service="models",
            method="POST",
            path=request.url.path,
            public_key=request.app.state.identity_public_key,
        )
    except (jwt.InvalidTokenError, TypeError, ValueError):
        raise HTTPException(401, "integration_capacity_grant_required") from None
    client = getattr(request.app.state, "integration_intents", None)
    if client is None:
        raise HTTPException(503, "integration_authorization_unavailable")
    try:
        decision = await client.check(intent_id)
    except IntegrationAuthorizationUnavailable:
        raise HTTPException(503, "integration_authorization_unavailable") from None
    if actor != decision.actor or decision.scope.kind not in {"mcp.validate", "tool.validate"}:
        raise HTTPException(403, "integration_capacity_scope_mismatch")
    if operation in {"acquire", "demo"} and not decision.allowed:
        raise HTTPException(403, "integration_authorization_revoked")
    return actor, decision.scope


@router.post("/{intent_id}/acquire")
async def acquire(request: Request, intent_id: UUID):
    actor, scope = await principal(request, intent_id, "acquire")
    return await acquire_capacity(request.app.state.database.sessions, intent_id, actor, scope)


@router.post("/{intent_id}/release")
async def release(request: Request, intent_id: UUID, body: ReleaseInput):
    if body.outcome not in {"completed", "failed", "cancelled", "not-started"}:
        raise HTTPException(422, "integration_terminal_outcome_required")
    actor, scope = await principal(request, intent_id, "release")
    return await release_capacity(
        request.app.state.database.sessions, intent_id, actor, scope, body.outcome
    )


class DemoToolInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tool: Literal["orders", "products", "product"]
    input: dict


@router.post("/{intent_id}/demo")
async def demo(request: Request, intent_id: UUID, body: DemoToolInput):
    _actor, scope = await principal(request, intent_id, "demo")
    if scope.kind != "tool.validate" or scope.input_sha256 != digest(body.input):
        raise HTTPException(403, "integration_demo_scope_mismatch")
    try:
        return await request.app.state.demo_runtime.tool_reply(body.tool, body.input)
    except RuntimeError:
        raise HTTPException(503, "demo_service_unavailable") from None
