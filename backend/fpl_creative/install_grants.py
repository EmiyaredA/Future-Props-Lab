"""Authorize one target batch against the persisted request and current publication."""

import time
from typing import Literal

import jwt
from pydantic import ValidationError

from app.console.creative_workshop.schemas import CreativeInstallPreviewIn
from fpl_runtime.creative_install_evidence import AUDIENCE
from fpl_runtime.creative_integrations import CreativeInstallBatch, CreativeOperationGrant
from fpl_runtime.integration_intents import digest

from .install_authorization import (
    IdentityInstallAuthorization,
    InstallAuthorizationDenied,
    InstallSource,
)
from .installation_outbox import InstallationOutbox, InstallIntentConflict


class InstallGrantAuthority:
    def __init__(self, outbox: InstallationOutbox, authorization: IdentityInstallAuthorization):
        self.outbox, self.authorization = outbox, authorization

    async def authorize(
        self,
        action: Literal["install", "receipt"],
        source: InstallSource,
        batch: CreativeInstallBatch,
    ) -> CreativeOperationGrant:
        if action not in {"install", "receipt"} or not isinstance(batch, CreativeInstallBatch):
            raise InstallAuthorizationDenied("安装操作无效")
        try:
            request = CreativeInstallPreviewIn.model_validate_json(source.raw_body)
        except (AttributeError, TypeError, ValueError, ValidationError):
            raise InstallAuthorizationDenied("安装请求无效") from None
        owner = await self.authorization.require(source, request)
        intent = await self.outbox.get(owner, request.release_id)
        if (
            intent is None
            or intent.batch != batch
            or intent.request_fingerprint != digest(request.model_dump(mode="json"))
        ):
            raise InstallAuthorizationDenied("安装批次与原始请求不匹配")
        if action == "install":
            try:
                await self.outbox.require_current(owner, request, batch)
            except InstallIntentConflict:
                raise InstallAuthorizationDenied("公开版本已变化或不可用") from None
        # Hashing a Skill tree can take time; never extend the original authorization.
        if await self.authorization.require(source, request) != owner:
            raise InstallAuthorizationDenied("安装账号已变化")
        try:
            evidence = jwt.decode(
                source.evidence,
                self.authorization.public_key,
                algorithms=["EdDSA"],
                issuer="fpl-identity",
                audience=AUDIENCE,
                options={"require": ["exp"]},
            )
            original = jwt.decode(
                source.assertion,
                self.authorization.public_key,
                algorithms=["EdDSA"],
                issuer="fpl-identity",
                audience="creative",
                options={"require": ["exp"]},
            )
            now = int(time.time())
            expires = min(now + 5, evidence["exp"], original["exp"])
            if type(expires) is not int or expires <= now:
                raise ValueError("authorization expired")
        except (jwt.InvalidTokenError, KeyError, TypeError, ValueError):
            raise InstallAuthorizationDenied("安装请求授权已失效") from None
        return CreativeOperationGrant(
            owner, action, batch.operation_id, intent.fingerprint, expires
        )
