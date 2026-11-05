"""Request-bound installation coordination through explicit authenticated ports.

No implementation in this module provides HTTP, Identity delegation or Skill
transport. Until those ports are independently configured this is not mounted.
"""

from typing import Protocol

from app.console.creative_workshop.schemas import CreativeInstallOut, CreativeInstallPreviewIn
from fpl_runtime.creative_integrations import CreativeInstallBatch
from fpl_runtime.integration_intents import digest

from .installation_outbox import InstallationOutbox, InstallIntentConflict


class OriginalInstallAuthorization(Protocol):
    async def require(self, source_authorization: object, request: CreativeInstallPreviewIn) -> str:
        """Verify original signed request and exact body; return its current account."""
        ...


class AuthorizedInstallTarget(Protocol):
    async def receipt(
        self, source_authorization: object, batch: CreativeInstallBatch
    ) -> object | None:
        """Read only this batch's authenticated target receipt; None means confirmed absent."""
        ...

    async def install(self, source_authorization: object, batch: CreativeInstallBatch) -> object:
        """Submit with delegated authority, current publication proof and verified Skill bytes.

        An existing receipt may be read after withdrawal, but a first target
        application must reject withdrawn releases.
        """
        ...

    async def cancel(self, source_authorization: object, batch: CreativeInstallBatch) -> object:
        """Atomically prevent a new target commit or return an already committed receipt."""
        ...

    async def verify_cancellation(
        self, source_authorization: object, batch: CreativeInstallBatch, response: object
    ) -> dict:
        """Authenticate and bind the target's cancellation result to this batch."""
        ...

    async def verify_receipt(
        self, source_authorization: object, batch: CreativeInstallBatch, response: object
    ) -> dict:
        """Authenticate target response and return its verified receipt or raise."""
        ...


class InstallationCoordinator:
    def __init__(
        self,
        outbox: InstallationOutbox,
        authorization: OriginalInstallAuthorization,
        target: AuthorizedInstallTarget,
    ):
        self.outbox, self.authorization, self.target = outbox, authorization, target

    async def cancel(self, source_authorization: object, request: CreativeInstallPreviewIn) -> dict:
        """Release publication fences only after a verified target cancellation result."""
        owner = await self.authorization.require(source_authorization, request)
        if not isinstance(owner, str) or not owner:
            raise InstallIntentConflict("取消授权未绑定账号")
        intent = await self.outbox.get(owner, request.release_id)
        if intent is None or intent.request_fingerprint != digest(request.model_dump(mode="json")):
            raise InstallIntentConflict("安装批次不存在或与请求不匹配")
        if intent.state == "cancelled":
            return {"state": "cancelled"}
        if intent.state == "completed":
            result = await self.outbox.complete(owner, request.release_id, intent.receipt)
            return {"state": "committed", "installation": result.model_dump(mode="json")}
        if intent.state != "pending":
            raise InstallIntentConflict("安装批次状态无效")
        response = await self.target.cancel(source_authorization, intent.batch)
        verified = await self.target.verify_cancellation(
            source_authorization, intent.batch, response
        )
        if await self.authorization.require(source_authorization, request) != owner:
            raise InstallIntentConflict("取消授权账号已变化")
        if not isinstance(verified, dict):
            raise InstallIntentConflict("取消回执无效")
        if verified.get("state") == "cancelled":
            await self.outbox.cancel(owner, request.release_id, verified)
            return {"state": "cancelled"}
        if verified.get("state") == "committed" and set(verified) == {"state", "receipt"}:
            receipt = await self.target.verify_receipt(
                source_authorization, intent.batch, verified["receipt"]
            )
            result = await self.outbox.complete(owner, request.release_id, receipt)
            return {"state": "committed", "installation": result.model_dump(mode="json")}
        raise InstallIntentConflict("取消回执无效")

    async def resume(
        self, source_authorization: object, request: CreativeInstallPreviewIn
    ) -> CreativeInstallOut:
        """Resume a previously accepted operation without rebuilding its batch."""
        owner = await self.authorization.require(source_authorization, request)
        if not isinstance(owner, str) or not owner:
            raise InstallIntentConflict("安装授权未绑定账号")
        intent = await self.outbox.get(owner, request.release_id)
        if intent is None:
            raise InstallIntentConflict("安装批次不存在")
        return await self.install(source_authorization, request, intent.batch)

    async def install(
        self,
        source_authorization: object,
        request: CreativeInstallPreviewIn,
        proposed: CreativeInstallBatch,
    ) -> CreativeInstallOut:
        # The request-bound adapter derives this identity from Identity, never input.
        owner = await self.authorization.require(source_authorization, request)
        if not isinstance(owner, str) or not owner:
            raise InstallIntentConflict("安装授权未绑定账号")
        intent = await self.outbox.accept(owner, request, proposed)
        if intent.state == "completed":
            receipt = intent.receipt
        elif intent.state == "pending":
            # A failed or timed-out lookup raises; it must never be interpreted as
            # an absent receipt. Both calls use the exact stored operation UUID.
            response = await self.target.receipt(source_authorization, intent.batch)
            if response is None:
                await self.outbox.require_current(owner, request, intent.batch)
                response = await self.target.install(source_authorization, intent.batch)
            receipt = await self.target.verify_receipt(source_authorization, intent.batch, response)
        else:
            raise InstallIntentConflict("安装批次状态无效")
        # A long target call cannot extend source user authorization.
        if await self.authorization.require(source_authorization, request) != owner:
            raise InstallIntentConflict("安装授权账号已变化")
        return await self.outbox.complete(owner, intent.batch.root_release_id, receipt)
