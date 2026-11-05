"""HTTP account preconditions without credential storage or a session factory."""

from datetime import timedelta

from fastapi import HTTPException, Request

from app.capabilities.identity.security import REAUTH_MINUTES
from studio.contracts.identity.principal import StudioPrincipal
from studio.runtime.time import utc_now


def client_ip(request: Request) -> str:
    return request.client.host if request.client else ""


def unauthorized() -> HTTPException:
    return HTTPException(
        status_code=401,
        detail={"code": "studio_auth_required", "message": "需要登录"},
        headers={"WWW-Authenticate": "Session, Bearer"},
    )


def forbidden(code: str, message: str) -> HTTPException:
    return HTTPException(status_code=403, detail={"code": code, "message": message})


def require_recent_reauthentication(principal: StudioPrincipal) -> None:
    if principal.auth_kind != "session":
        raise forbidden("browser_session_required", "必须使用浏览器 Session")
    if principal.reauthenticated_at is None or utc_now() - principal.reauthenticated_at > timedelta(
        minutes=REAUTH_MINUTES
    ):
        raise forbidden("reauthentication_required", "请重新验证密码")
