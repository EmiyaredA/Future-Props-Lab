"""Forward the current signed identity to the resource owner; never infer authorization."""

from studio.contracts.gateway.resource_routes import RESOURCE_ROUTES


class ServiceResources:
    def __init__(self, capabilities, assertion, owner):
        self.capabilities = capabilities
        self.assertion = assertion
        self.owner = owner

    async def exists(self, owner, kind, resource_id):
        if owner != self.owner:
            return False
        route = RESOURCE_ROUTES[kind]
        return await self.capabilities.resource_exists(
            assertion=self.assertion,
            target_service=route.service,
            target_path=route.api.format(id=resource_id),
        )
