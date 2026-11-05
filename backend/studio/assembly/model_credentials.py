"""Call attribution from verified Identity context, with an explicit recovery adapter."""

from typing import Annotated

from fastapi import Depends, HTTPException, Request, WebSocket

from studio.assembly.http_dependencies import SessionDep, StudioAuth
from studio.contracts.identity.claims import Actor
from studio.contracts.identity.principal import StudioPrincipal
from studio.contracts.model_service.credential_snapshot import (
    SESSION_AUTH,
    CredentialSnapshot,
    snapshot_from_actor,
)


async def caller_credential(request: Request, session: SessionDep, principal: StudioAuth):
    reader = getattr(request.app.state, "model_credential_reader", None)
    if reader is not None:
        return await reader(session, principal)
    actor = getattr(request.state, "service_actor", None)
    if not isinstance(actor, Actor) or (
        actor.user_id,
        actor.auth_kind,
        actor.session_id,
        actor.api_key_id,
    ) != (principal.user_id, principal.auth_kind, principal.session_id, principal.api_key_id):
        raise HTTPException(401, {"code": "credential_context_required"})
    return snapshot_from_actor(actor)


async def socket_credential(websocket: WebSocket, principal: StudioPrincipal):
    if principal.auth_kind != "session":
        raise HTTPException(403, {"code": "browser_session_required"})
    reader = getattr(websocket.app.state, "model_credential_reader", None)
    if reader is not None:
        async with websocket.app.state.database.sessions() as session:
            return await reader(session, principal)
    return CredentialSnapshot(auth_kind=SESSION_AUTH)


CallCredentialDep = Annotated[CredentialSnapshot, Depends(caller_credential)]
