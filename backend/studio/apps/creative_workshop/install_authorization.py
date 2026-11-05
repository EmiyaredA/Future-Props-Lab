"""Revalidate an exact gateway-attested Creative installation request."""

import hashlib
from dataclasses import dataclass, field

import jwt
from pydantic import ValidationError

from app.console.creative_workshop.schemas import CreativeInstallPreviewIn
from studio.contracts.creative_workshop.creative_install_evidence import (
    INSTALL_PATH,
    install_fields,
    verify_install_evidence,
)
from studio.contracts.identity.claims import verify_context
from studio.contracts.identity.permissions import effective_permissions
from studio.contracts.identity.route_permissions import route_permission


@dataclass(frozen=True)
class InstallSource:
    assertion: str = field(repr=False)
    evidence: str = field(repr=False)
    raw_body: bytes = field(repr=False)


class InstallAuthorizationDenied(ValueError):
    pass


class IdentityInstallAuthorization:
    def __init__(self, *, public_key, identity):
        self.public_key, self.identity = public_key, identity

    async def require(
        self, source_authorization: InstallSource, request: CreativeInstallPreviewIn
    ) -> str:
        try:
            if not isinstance(source_authorization, InstallSource):
                raise ValueError("invalid source")
            raw = source_authorization.raw_body
            release = install_fields(raw)
            parsed = CreativeInstallPreviewIn.model_validate_json(raw)
            if parsed != request:
                raise ValueError("install request mismatch")
            actor = verify_context(
                source_authorization.assertion,
                service="creative",
                method="POST",
                path=INSTALL_PATH,
                public_key=self.public_key,
            )
            claims = jwt.decode(
                source_authorization.assertion,
                self.public_key,
                algorithms=["EdDSA"],
                issuer="fpl-identity",
                audience="creative",
                options={"require": ["jti"]},
            )
            verify_install_evidence(
                source_authorization.evidence,
                public_key=self.public_key,
                owner_user_id=actor.user_id,
                request_id=claims["jti"],
                body_sha256=hashlib.sha256(raw).hexdigest(),
                release_id=release,
            )
            permission = route_permission("POST", INSTALL_PATH)
            if (
                actor.purpose != "studio"
                or permission is None
                or permission
                not in effective_permissions(actor.platform_role, frozenset(actor.scopes))
            ):
                raise ValueError("permission denied")
        except (ValueError, TypeError, KeyError, ValidationError, jwt.InvalidTokenError):
            raise InstallAuthorizationDenied("安装请求授权无效") from None
        active = await self.identity.status(
            assertion=source_authorization.assertion, method="POST", path=INSTALL_PATH
        )
        if active is not True:
            raise InstallAuthorizationDenied("安装请求授权已失效或暂不可验证")
        return actor.user_id
