"""Developer-authored acceptance plans and read-only deployment connection status."""

import os

from app.capabilities.agents.cli.catalog import DEFINITIONS, connection
from app.capabilities.agents.cli.process import probe
from app.console.governance.code_agents import authorized
from app.llm.visual_catalog import fixed_acceptance_model as fixed_model
from app.llm.visual_review import fixed_connection_signature
from app.runtime.config import get_settings

from .schemes import SCHEMES, catalog_out, scheme_out


def cli_configuration(settings, scheme_id):
    agent_id = scheme_id.removeprefix("motion-transfer:")
    _, path, _ = connection(settings, agent_id)
    prefix = "claude" if agent_id == "claude-code" else agent_id
    users = getattr(settings, f"fpl_acceptance_{prefix}_user_ids", "")
    return agent_id, path, set(filter(None, users.split(os.pathsep)))


async def scheme_status(
    session, owner_user_id, user_id, identity, *, check_cli=True, settings=None
):
    settings = settings or get_settings()
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


async def catalog(session, owner_user_id, user_id):
    return catalog_out(
        [await scheme_status(session, owner_user_id, user_id, key) for key in SCHEMES]
    )


def connection_signature(scheme_id, settings, pair=None):
    import hashlib
    import json

    def fingerprint(value):
        return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()

    if pair:
        return fixed_connection_signature(pair)
    kind, path, _ = cli_configuration(settings, scheme_id)
    return fingerprint({"kind": kind, "executable": path})
