"""Explicit test adapters use only the suite's isolated website configuration."""

from studio.apps.integrations.external.catalog import ExternalConnections
from studio.apps.integrations.mcp.client import OfficialMcpDiscoveryClient
from studio.apps.integrations.skills.archive import SkillArchiveStorage
from studio.runtime.secrets import SecretCipher
from website_test_support import settings


def cipher():
    return SecretCipher(settings.fpl_secrets_key)


def client():
    return OfficialMcpDiscoveryClient(settings)


def storage(owner):
    return SkillArchiveStorage(settings, owner)


def connections(transport):
    encryption = cipher()
    return lambda session, owner: ExternalConnections(session, owner, transport, cipher=encryption)
