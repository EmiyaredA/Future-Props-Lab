"""Developer-authored acceptance plans and read-only deployment connection status."""

import os

from studio.apps.identity.website_access.code_agents import authorized
from studio.apps.model_service.catalog.visual import fixed_acceptance_model as fixed_model
from studio.apps.model_service.providers.visual_review import fixed_connection_signature
from studio.apps.visual_workshop.acceptance.schemes import SCHEMES, catalog_out, scheme_out
from studio.host.agent_execution.cli.catalog import DEFINITIONS, connection, execution_signature
from studio.host.agent_execution.cli.process import probe


def cli_configuration(settings, scheme_id):
    agent_id = scheme_id.removeprefix("motion-transfer:")
    _, path, _ = connection(settings, agent_id)
    prefix = "claude" if agent_id == "claude-code" else agent_id
    users = getattr(settings, f"fpl_acceptance_{prefix}_user_ids", "")
    return agent_id, path, set(filter(None, users.split(os.pathsep)))


async def scheme_status(session, owner_user_id, user_id, identity, *, settings, check_cli=True):
    title, kind = SCHEMES[identity]
    label, slug, provider_kind = title, "", ""
    if kind == "model_api":
        pair = await fixed_model(session, owner_user_id, settings)
        available = bool(pair)
        message = "已配置" if pair else "尚未配置本空间可用的固定视觉模型"
        if pair:
            label = f"{pair[0].label or pair[0].slug} · {pair[1].name}"
            slug, provider_kind = pair[0].slug, pair[1].kind
    else:
        agent, path, _users = cli_configuration(settings, identity)
        label = DEFINITIONS[agent].name

        available = bool(
            path and await authorized(session, owner_user_id, user_id, agent, "visual_acceptance")
        )
        message = "已配置" if available else "此账号尚未获准使用该固定 Agent 连接"
        if available and check_cli:
            available, message = await probe(agent, path)
    return scheme_out(
        identity, available, message, label=label, slug=slug, provider_kind=provider_kind
    )


async def catalog(session, owner_user_id, user_id, *, settings):
    return catalog_out(
        [
            await scheme_status(session, owner_user_id, user_id, key, settings=settings)
            for key in SCHEMES
        ]
    )


def connection_signature(scheme_id, settings, pair=None):
    if pair:
        return fixed_connection_signature(pair)
    kind, path, _ = cli_configuration(settings, scheme_id)
    return execution_signature(kind, path)
