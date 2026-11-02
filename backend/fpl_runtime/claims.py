"""Request-bound authentication assertions, issued only by Identity."""

import time
from dataclasses import dataclass
from datetime import datetime
from uuid import uuid4

import jwt

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

    def __post_init__(self):
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
        elif not isinstance(self.api_key_id, str) or not self.api_key_id or self.session_id:
            raise ValueError("API Key 上下文无效")
        if self.reauthenticated_at is not None:
            datetime.fromisoformat(self.reauthenticated_at)
        if self.local and self.auth_kind != "session":
            raise ValueError("主机权限只允许本机浏览器 Session")


def issue_context(actor: Actor, *, service, method, path, private_key, key_id, now=None):
    from .catalog import service_by_id

    service_by_id(service)
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
        "scopes": actor.scopes,
        "session": actor.session_id,
        "api_key": actor.api_key_id,
        "local": actor.local,
        "reauthenticated_at": actor.reauthenticated_at,
    }
    return jwt.encode(claims, private_key, algorithm="EdDSA", headers={"kid": key_id})


def verify_context(token, *, service, method, path, public_key, allow_expired=False):
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
    return Actor(
        user_id=claims["sub"],
        platform_role=claims["role"],
        auth_kind=claims["kind"],
        scopes=tuple(claims["scopes"]),
        session_id=claims.get("session"),
        api_key_id=claims.get("api_key"),
        local=claims["local"],
        reauthenticated_at=claims.get("reauthenticated_at"),
    )
