"""Bind the website's integration dependencies without business configuration lookups."""

from studio.apps.integrations.external.catalog import ExternalConnections
from studio.apps.integrations.mcp.catalog import McpCatalog
from studio.apps.integrations.mcp.client import OfficialMcpDiscoveryClient
from studio.apps.integrations.skills.archive import SkillArchiveStorage
from studio.apps.integrations.skills.catalog import SkillCatalog
from studio.apps.integrations.tool_apis.catalog import ToolApiCatalog
from studio.apps.integrations.transport.bindings import IntegrationBindings
from studio.runtime.secrets import SecretCipher


def integration_bindings(settings, demo_tools):
    cipher = SecretCipher(settings.fpl_secrets_key)
    client = OfficialMcpDiscoveryClient(settings)
    return IntegrationBindings(
        tool_apis=lambda _request, session, owner: ToolApiCatalog(
            session, owner, demo_tools=demo_tools, cipher=cipher
        ),
        mcp=lambda _request, session, owner: McpCatalog(
            session, owner, client=client, cipher=cipher
        ),
        skills=lambda _request, session, owner: SkillCatalog(
            session, owner, storage=SkillArchiveStorage(settings, owner)
        ),
        external=lambda _request, session, owner: ExternalConnections(
            session, owner, cipher=cipher
        ),
    )
