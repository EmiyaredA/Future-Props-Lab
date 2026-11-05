"""Explicit installation port; the recovery adapter is assembled separately."""

from typing import Protocol

from studio.contracts.creative_workshop.catalog import (
    CreativeInstallOut,
    CreativeInstallPreviewIn,
    CreativeInstallPreviewOut,
    CreativeStdioSetupIn,
)
from studio.contracts.creative_workshop.errors import CreativeError
from studio.contracts.identity.principal import StudioPrincipal


class CreativeInstallationPort(Protocol):
    async def preview(self, body: CreativeInstallPreviewIn) -> CreativeInstallPreviewOut: ...
    async def install(self, body: CreativeInstallPreviewIn) -> CreativeInstallOut: ...
    async def configure_stdio(
        self, installation_id: str, body: CreativeStdioSetupIn
    ) -> CreativeInstallOut: ...


class CreativeInstaller:
    def __init__(self, principal: StudioPrincipal, *, installation: CreativeInstallationPort):
        self.principal, self.installation = principal, installation

    def port(self) -> CreativeInstallationPort:
        if not self.principal.allows("configuration.manage"):
            raise CreativeError("需要当前账号的集成管理权限", 403, "permission_denied")
        return self.installation

    async def preview(self, body: CreativeInstallPreviewIn) -> CreativeInstallPreviewOut:
        return await self.port().preview(body)

    async def install(self, body: CreativeInstallPreviewIn) -> CreativeInstallOut:
        return await self.port().install(body)

    async def configure_stdio(
        self, installation_id: str, body: CreativeStdioSetupIn
    ) -> CreativeInstallOut:
        return await self.port().configure_stdio(installation_id, body)
