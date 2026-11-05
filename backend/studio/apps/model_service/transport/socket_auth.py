"""A browser socket consumes its gateway assertion and revalidates its original session."""

from datetime import datetime

import jwt
from fastapi import HTTPException

from app.runtime.ownership import bind_owner
from studio.contracts.identity.claims import Actor, verify_context
from studio.contracts.identity.principal import StudioPrincipal


def socket_authenticator(public_key, identity):
    async def authenticate(websocket, session):
        token = websocket.headers.get("x-fpl-context", "")
        original = getattr(websocket.state, "model_socket_actor", None)
        try:
            actor = verify_context(
                token,
                service="models",
                method="GET",
                path=websocket.url.path,
                public_key=public_key,
                allow_expired=isinstance(original, Actor),
            )
        except (jwt.InvalidTokenError, TypeError, ValueError):
            raise HTTPException(401, {"code": "studio_auth_required"}) from None
        if (
            actor.auth_kind != "session"
            or actor.purpose != "studio"
            or (original is not None and original != actor)
        ):
            raise HTTPException(403, {"code": "browser_session_required"})
        principal = StudioPrincipal(
            user_id=actor.user_id,
            must_change_password=False,
            auth_kind="session",
            scopes=frozenset(actor.scopes),
            platform_role=actor.platform_role,
            session_id=actor.session_id,
            reauthenticated_at=datetime.fromisoformat(actor.reauthenticated_at)
            if actor.reauthenticated_at
            else None,
        )
        if not principal.allows("models.use") or not await identity.active(
            assertion=token, method="GET", path=websocket.url.path
        ):
            raise HTTPException(403, {"code": "model_access_changed"})
        websocket.state.model_socket_actor = actor
        websocket.state.service_actor = actor
        websocket.state.service_assertion = token
        websocket.state.website_local = actor.local
        bind_owner(session, actor.user_id)
        return principal

    return authenticate
