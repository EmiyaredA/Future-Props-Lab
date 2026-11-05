"""Service-local browser checks consume Identity's verified request context."""

from fastapi import HTTPException

from app.deps import authenticate_studio_request


async def browser(request, session, *, admin=False):
    principal = await authenticate_studio_request(request, session, required_scope="studio:read")
    if principal.auth_kind != "session" or principal.session_id is None:
        raise HTTPException(403, {"code": "browser_session_required"})
    if (
        admin
        and getattr(getattr(request.state, "service_actor", None), "purpose", None) != "management"
    ):
        raise HTTPException(403, {"code": "management_session_required"})
    if admin and not principal.is_platform_admin:
        raise HTTPException(403, {"code": "platform_admin_required"})
    return principal
