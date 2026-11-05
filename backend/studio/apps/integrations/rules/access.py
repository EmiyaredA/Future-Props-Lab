from studio.contracts.identity.principal import StudioPrincipal
from studio.contracts.integrations.errors import IntegrationPermissionError


def require_integration_owner(principal: StudioPrincipal) -> None:
    if not principal.allows("configuration.manage"):
        raise IntegrationPermissionError("只有账号Owner 可以管理集成")
