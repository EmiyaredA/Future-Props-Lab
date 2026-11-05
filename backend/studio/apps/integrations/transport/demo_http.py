"""Only Models' accepted demo-install intent can create the fixed synthetic tools."""

from uuid import UUID

import jwt
from fastapi import APIRouter, HTTPException, Request

from studio.apps.integrations.clients.authority import IntegrationAuthorizationUnavailable
from studio.contracts.identity.claims import HEADER, verify_context

router = APIRouter(prefix="/_internal/v1/demo-tool-installations", include_in_schema=False)


async def authorization(request, intent_id, *, execute):
    if request.headers.get("origin") or request.headers.get("cookie"):
        raise HTTPException(403, "demo_install_grant_required")
    try:
        actor = verify_context(
            request.headers.get(HEADER, ""),
            service="integrations",
            method=request.method,
            path=request.url.path,
            public_key=request.app.state.identity_public_key,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "demo_install_grant_required") from None
    try:
        decision = await request.app.state.integration_intents.check(intent_id)
    except IntegrationAuthorizationUnavailable:
        raise HTTPException(503, "integration_authorization_unavailable") from None
    if decision.actor != actor or decision.scope.kind != "demo.install":
        raise HTTPException(403, "demo_install_scope_mismatch")
    if execute and not decision.allowed:
        raise HTTPException(403, "demo_install_authorization_revoked")
    return actor, decision.scope


@router.get("/{intent_id}")
async def receipt(request: Request, intent_id: UUID):
    actor, _scope = await authorization(request, intent_id, execute=False)
    value = await request.app.state.demo_tool_installations.receipt(actor.user_id, intent_id)
    if value is None:
        raise HTTPException(404, "demo_install_not_accepted")
    return value


@router.post("/{intent_id}")
async def install(request: Request, intent_id: UUID):
    actor, scope = await authorization(request, intent_id, execute=True)
    return await request.app.state.demo_tool_installations.install(actor, scope, intent_id)
