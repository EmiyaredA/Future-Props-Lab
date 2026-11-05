"""Request-bound authentication assertions, issued only by Identity."""

import re
import time
from dataclasses import dataclass
from datetime import datetime
from uuid import uuid4

import jwt

from studio.contracts.identity.approved_operations import valid_request_sha256
from studio.contracts.identity.cloud_authority import is_desktop_upgrade

ISSUER = "fpl-identity"
HEADER = "x-fpl-context"


@dataclass(frozen=True)
class Actor:
    user_id: str
    platform_role: str
    auth_kind: str
    scopes: tuple[str, ...]
    session_id: str | None = None
    api_key_id: str | None = None
    local: bool = False
    reauthenticated_at: str | None = None

    purpose: str = "studio"
    api_key_name: str | None = None
    api_key_prefix: str | None = None
    client_ip: str | None = None
    desktop_ticket_sha256: str | None = None

    def __post_init__(self):
        if self.purpose not in {"studio", "management"}:
            raise ValueError("会话用途无效")
        if type(self.local) is not bool or not isinstance(self.scopes, tuple):
            raise ValueError("认证上下文类型无效")
        if not self.user_id or self.platform_role not in {"admin", "user"}:
            raise ValueError("账号上下文无效")
        if self.auth_kind not in {"session", "management_api_key"}:
            raise ValueError("认证方式无效")
        if any(not isinstance(scope, str) or not scope for scope in self.scopes):
            raise ValueError("认证权限无效")
        if self.auth_kind == "session":
            if not isinstance(self.session_id, str) or not self.session_id or self.api_key_id:
                raise ValueError("Session 上下文无效")
            if self.api_key_name is not None or self.api_key_prefix is not None:
                raise ValueError("Session 不含 API Key 元数据")
        elif not isinstance(self.api_key_id, str) or not self.api_key_id or self.session_id:
            raise ValueError("API Key 上下文无效")
        if self.client_ip is not None:
            from ipaddress import ip_address

            if not isinstance(self.client_ip, str) or len(self.client_ip) > 64:
                raise ValueError("审计客户端地址无效")
            ip_address(self.client_ip)
        if self.reauthenticated_at is not None:
            datetime.fromisoformat(self.reauthenticated_at)
        if self.local and self.auth_kind != "session":
            raise ValueError("主机权限只允许本机浏览器 Session")
        if self.desktop_ticket_sha256 is not None and (
            self.auth_kind != "session"
            or self.purpose != "studio"
            or self.platform_role != "admin"
            or not isinstance(self.desktop_ticket_sha256, str)
            or not re.fullmatch(r"[0-9a-f]{64}", self.desktop_ticket_sha256)
        ):
            raise ValueError("桌面票据上下文无效")
        for value, limit in ((self.api_key_name, 64), (self.api_key_prefix, 16)):
            if value is not None and (not isinstance(value, str) or len(value) > limit):
                raise ValueError("API Key 归因元数据无效")


def issue_context(
    actor: Actor, *, service, method, path, private_key, key_id, now=None, request_sha256=None
):
    from studio.contracts.gateway.catalog import service_by_id

    service_by_id(service)
    if (actor.desktop_ticket_sha256 is not None) != is_desktop_upgrade(service, method, path):
        raise ValueError("桌面票据必须绑定到 Remote WebSocket")
    now = int(time.time()) if now is None else now
    claims = {
        "iss": ISSUER,
        "aud": service,
        "sub": actor.user_id,
        "iat": now,
        "nbf": now,
        "exp": now + 20,
        "jti": uuid4().hex,
        "method": method.upper(),
        "path": path,
        "role": actor.platform_role,
        "kind": actor.auth_kind,
        "purpose": actor.purpose,
        "scopes": actor.scopes,
        "session": actor.session_id,
        "api_key": actor.api_key_id,
        "api_key_name": actor.api_key_name,
        "api_key_prefix": actor.api_key_prefix,
        "local": actor.local,
        "reauthenticated_at": actor.reauthenticated_at,
        **({"client_ip": actor.client_ip} if actor.client_ip is not None else {}),
        **(
            {"desktop_ticket_sha256": actor.desktop_ticket_sha256}
            if actor.desktop_ticket_sha256 is not None
            else {}
        ),
    }
    if request_sha256 is not None:
        if not valid_request_sha256(request_sha256):
            raise ValueError("请求摘要无效")
        claims["request_sha256"] = request_sha256
    return jwt.encode(claims, private_key, algorithm="EdDSA", headers={"kid": key_id})


def verify_context(token, *, service, method, path, public_key, allow_expired=False):
    actor, _ = verify_request_context(
        token,
        service=service,
        method=method,
        path=path,
        public_key=public_key,
        allow_expired=allow_expired,
    )
    return actor


def verify_request_context(token, *, service, method, path, public_key, allow_expired=False):
    claims = jwt.decode(
        token,
        public_key,
        algorithms=["EdDSA"],
        issuer=ISSUER,
        audience=service,
        options={
            "verify_exp": not allow_expired,
            "require": [
                "sub",
                "iat",
                "nbf",
                "exp",
                "jti",
                "aud",
                "iss",
                "method",
                "path",
                "role",
                "kind",
                "scopes",
                "local",
            ],
        },
        leeway=2,
    )
    if (claims["method"], claims["path"]) != (method.upper(), path):
        raise jwt.InvalidTokenError("认证上下文不属于此请求")
    if claims["exp"] - claims["iat"] != 20:
        raise jwt.InvalidTokenError("认证上下文有效期无效")
    desktop_ticket = claims.get("desktop_ticket_sha256")
    if (desktop_ticket is not None) != is_desktop_upgrade(service, method, path):
        raise jwt.InvalidTokenError("桌面票据不属于此请求")
    checksum = claims.get("request_sha256")
    if checksum is not None and not valid_request_sha256(checksum):
        raise jwt.InvalidTokenError("请求摘要无效")
    actor = Actor(
        user_id=claims["sub"],
        purpose=claims.get("purpose", "studio"),
        platform_role=claims["role"],
        auth_kind=claims["kind"],
        scopes=tuple(claims["scopes"]),
        session_id=claims.get("session"),
        api_key_id=claims.get("api_key"),
        api_key_name=claims.get("api_key_name"),
        api_key_prefix=claims.get("api_key_prefix"),
        client_ip=claims.get("client_ip"),
        desktop_ticket_sha256=desktop_ticket,
        local=claims["local"],
        reauthenticated_at=claims.get("reauthenticated_at"),
    )
    return actor, checksum
