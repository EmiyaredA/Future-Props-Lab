"""Explicit installation port; the recovery adapter is assembled separately."""

from typing import Protocol

from app.capabilities.identity.principal import StudioPrincipal
from app.console.creative_workshop.catalog import CreativeError
from app.console.creative_workshop.schemas import (
    CreativeInstallOut,
    CreativeInstallPreviewIn,
    CreativeInstallPreviewOut,
    CreativeStdioSetupIn,
)


class CreativeInstallationPort(Protocol):
    async def preview(self, body: CreativeInstallPreviewIn) -> CreativeInstallPreviewOut: ...
    async def install(self, body: CreativeInstallPreviewIn) -> CreativeInstallOut: ...
    async def configure_stdio(
        self, installation_id: str, body: CreativeStdioSetupIn
    ) -> CreativeInstallOut: ...


class CreativeInstaller:
    def __init__(self, session, principal: StudioPrincipal):
        self.session, self.principal = session, principal

    def port(self) -> CreativeInstallationPort:
        if not self.principal.allows("configuration.manage"):
            raise CreativeError("需要当前账号的集成管理权限", 403, "permission_denied")
        factory = self.session.info.get("creative_installer_factory")
        if factory is None:
            raise CreativeError("创作安装服务尚未连接", 503, "creative_install_unavailable")
        return factory(self.session, self.principal)

    async def preview(self, body: CreativeInstallPreviewIn) -> CreativeInstallPreviewOut:
        return await self.port().preview(body)

    async def install(self, body: CreativeInstallPreviewIn) -> CreativeInstallOut:
        return await self.port().install(body)

    async def configure_stdio(
        self, installation_id: str, body: CreativeStdioSetupIn
    ) -> CreativeInstallOut:
        return await self.port().configure_stdio(installation_id, body)
