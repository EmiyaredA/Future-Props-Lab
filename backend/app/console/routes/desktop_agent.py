"""HTTP boundary for local agent pairing and bounded desktop navigation."""

import time

from fastapi import APIRouter, Depends, HTTPException, Request

from app.console.governance.desktop_agent import MANIFEST, AgentError, DesktopAgent, allows_agent
from app.console.governance.desktop_ui import open_resource, ui_request
from app.console.routes.desktop import require_desktop
from app.console.schemas.desktop_agent import (
    AgentCapabilities,
    AgentClaimIn,
    AgentClaimOut,
    AgentDecisionIn,
    AgentPairIn,
    AgentPairOut,
    AgentPairStarted,
    DesktopInbox,
    DesktopOpenAck,
    DesktopOpenIn,
    DesktopOpenOut,
)
from app.deps import SessionDep, authenticate_studio_request, client_ip

router = APIRouter(prefix="/desktop", tags=["desktop"], dependencies=[Depends(require_desktop)])


def configure_agent(app):
    from starlette.responses import JSONResponse

    app.state.desktop_agent = DesktopAgent()

    async def agent_error(_request, exc):
        return JSONResponse({"code": exc.code, "message": exc.code}, status_code=exc.status)

    app.add_exception_handler(AgentError, agent_error)
    return allows_agent


def runtime(request):
    return request.app.state.desktop_agent


async def identity(request, session, *, browser=False):
    principal = await authenticate_studio_request(
        request, session, required_scope="studio:private_read"
    )
    if browser and principal.auth_kind != "session":
        raise HTTPException(403, detail="browser_session_required")
    return principal


def agent_channel(request):
    if request.headers.get("x-fpl-agent-channel") != "1":
        raise HTTPException(403, detail="agent_channel_required")


@router.post("/agent/pairings", response_model=AgentPairStarted, status_code=201)
async def begin_pairing(request: Request, body: AgentPairIn):
    agent_channel(request)
    return runtime(request).begin(body.name, body.scope)


@router.post("/agent/pairings/{pair_id}/claim", response_model=AgentClaimOut)
async def claim_pairing(request: Request, pair_id: str, body: AgentClaimIn):
    agent_channel(request)
    return await runtime(request).claim(pair_id, body.claim_token)


@router.get("/agent/pairings", response_model=list[AgentPairOut])
async def pending_pairings(request: Request, session: SessionDep):
    await identity(request, session, browser=True)
    state = runtime(request)
    state.prune()
    return [row for row in state.pairings.values() if row["status"] == "pending"]


@router.post("/agent/pairings/{pair_id}/decision", response_model=AgentPairOut)
async def decide_pairing(
    request: Request, pair_id: str, body: AgentDecisionIn, session: SessionDep
):
    principal = await identity(request, session, browser=True)
    if body.expected_owner_user_id != principal.owner_user_id:
        raise AgentError(409, "account_access_changed")
    return await runtime(request).decide(pair_id, body, session, principal, client_ip(request))


@router.get("/agent/capabilities", response_model=AgentCapabilities)
async def capabilities(request: Request, session: SessionDep):
    principal = await identity(request, session)
    schema = request.app.openapi()
    operations = {}
    for key, operation in MANIFEST["operations"].items():
        method, path = key.split(" ", 1)
        operations[f"{operation['resource']}.{operation['method']}"] = {
            "method": method,
            "path": path,
            **schema["paths"][path][method.lower()],
        }
    return dict(
        version=MANIFEST["version"],
        user_id=principal.user_id,
        owner_user_id=principal.owner_user_id,
        scopes=sorted(principal.scopes),
        operations=operations,
        schemas=schema["components"]["schemas"],
    )


@router.post("/ui/open", response_model=DesktopOpenOut, status_code=202)
async def open_in_app(request: Request, body: DesktopOpenIn, session: SessionDep):
    principal = await identity(request, session)
    if not principal.allows("content.read"):
        raise HTTPException(403, detail="insufficient_permission")
    return await open_resource(runtime(request), session, principal, body)


@router.get("/ui/requests/{request_id}", response_model=DesktopOpenOut)
async def open_status(request: Request, request_id: str, session: SessionDep):
    return ui_request(runtime(request), await identity(request, session), request_id)


@router.get("/ui/inbox", response_model=DesktopInbox)
async def inbox(request: Request, session: SessionDep):
    principal = await identity(request, session, browser=True)
    state = runtime(request)
    state.prune()
    audience = (principal.user_id, principal.owner_user_id)
    state.viewers[audience] = time.monotonic()
    return dict(
        requests=[
            row
            for row in state.ui_requests.values()
            if row["audience"] == audience and row["status"] == "pending"
        ],
        change_revision=state.changes.get(audience, 0),
        integration_revisions=state.integration_changes.get(audience, {}),
        content_change_revision=state.content_changes.get(audience, 0),
    )


@router.post("/ui/requests/{request_id}/ack", response_model=DesktopOpenOut)
async def acknowledge(request: Request, request_id: str, body: DesktopOpenAck, session: SessionDep):
    row = ui_request(runtime(request), await identity(request, session, browser=True), request_id)
    if row["status"] not in {"pending", "waiting_confirmation"}:
        raise AgentError(409, "ui_request_finished")
    row["status"] = body.status
    return row
