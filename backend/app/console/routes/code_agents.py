from fastapi import APIRouter, Depends, HTTPException, Request

from app.capabilities.agents.cli.contracts import CatalogOut
from app.deps import StudioAuth, require_recent_reauthentication
from studio.contracts.agent_runtime.definitions import AgentId
from studio.runtime.http.website import require_local_browser


def require_browser(principal: StudioAuth):
    if principal.auth_kind != "session":
        raise HTTPException(403, {"code": "browser_session_required"})


def can_manage_connections(request: Request, principal) -> bool:
    return (
        getattr(request.state, "website_local", False)
        and principal.is_platform_admin
        and principal.auth_kind == "session"
        and principal.allows("configuration.manage")
    )


router = APIRouter(
    prefix="/code-agents", tags=["code-agents"], dependencies=[Depends(require_browser)]
)


@router.get("", response_model=CatalogOut)
async def list_code_agents(request: Request, principal: StudioAuth):
    return await request.app.state.code_agent_catalog(
        request, can_enable=can_manage_connections(request, principal)
    )


@router.post("/detect", response_model=CatalogOut)
async def detect_code_agents(request: Request, principal: StudioAuth):
    return await list_code_agents(request, principal)


@router.post("/{agent_id}/enable", status_code=204)
async def enable_code_agent(agent_id: AgentId, request: Request, principal: StudioAuth):
    require_local_browser(request, principal)
    if not can_manage_connections(request, principal):
        raise HTTPException(403, {"code": "platform_admin_required"})
    require_recent_reauthentication(principal)
    await request.app.state.code_agent_enable(request, agent_id)
