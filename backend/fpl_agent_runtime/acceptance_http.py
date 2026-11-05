"""Read fixed CLI readiness from the Mac worker without exporting local paths."""

import jwt
from fastapi import APIRouter, HTTPException, Request

from app.capabilities.identity.permissions import effective_permissions
from fpl_runtime.agent_connections import ACCEPTANCE, AcceptanceAgentCatalog, AcceptanceProbe
from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.visual_catalog import AGENT_ACCEPTANCE_TARGET

from .host import unavailable

router = APIRouter(include_in_schema=False)


@router.get(AGENT_ACCEPTANCE_TARGET, response_model=AcceptanceAgentCatalog)
async def acceptance_agents(request: Request, probe: bool = True):
    if "origin" in request.headers or "cookie" in request.headers:
        raise HTTPException(403, "visual_acceptance_agent_grant_required")
    token = request.headers.get(HEADER, "")
    try:
        actor = verify_context(
            token,
            service="agent-runtime",
            method="GET",
            path=AGENT_ACCEPTANCE_TARGET,
            public_key=request.app.state.identity_public_key,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "visual_acceptance_agent_grant_required") from None
    if actor.purpose != "studio" or "content.read" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "visual_acceptance_agent_access_forbidden")
    job = await request.app.state.connections.run_bound(
        actor.user_id, token, ACCEPTANCE, AcceptanceProbe(probe=probe).model_dump()
    )
    if job["error_code"] == "authorization_revoked":
        raise HTTPException(403, "authorization_revoked")
    if job["status"] != "completed":
        raise unavailable()
    return AcceptanceAgentCatalog.model_validate(job["result"])
