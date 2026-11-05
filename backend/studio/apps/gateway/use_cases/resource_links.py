"""One navigation policy shared by website and independently deployed Gateway."""

from studio.apps.gateway.ports import ResourceReader
from studio.contracts.gateway.automation import AutomationOpenIn
from studio.contracts.gateway.resource_routes import page_link
from studio.contracts.identity.principal import StudioPrincipal


class ResourceLinkError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


class ResourceLinks:
    def __init__(self, reader: ResourceReader):
        self.reader = reader

    async def open(self, principal: StudioPrincipal, command: AutomationOpenIn) -> str:
        """Authorize a navigation target without changing resources or browser state."""
        if command.view in {"upload", "tags", "edit", "validate"} and not principal.allows(
            "configuration.manage"
        ):
            raise ResourceLinkError("insufficient_permission", "当前账号不允许配置此资源")
        if command.resource_id and not await self.reader.exists(
            principal.user_id, command.kind, command.resource_id
        ):
            raise ResourceLinkError("resource_not_found", "资源不存在")
        return page_link(command.kind, command.resource_id, command.view)
