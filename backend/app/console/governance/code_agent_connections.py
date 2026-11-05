"""Local deployment management for shared programming CLI connections."""

import asyncio

from fastapi import HTTPException

from app.capabilities.agents.cli.catalog import connection, inspect_connection, settings_prefix
from app.console.governance.deployment_config import config_bytes, replace_config, revision
from app.runtime.config import get_cloud_settings
from fpl_config import CONFIG_FILE


async def enable_connection(agent_id, *, before_publish=None):
    expected = revision(config_bytes(CONFIG_FILE))
    settings = get_cloud_settings()
    prefix = settings_prefix(agent_id)
    enabled_field = f"{prefix}_enabled"
    executable_field = f"{prefix}_executable"
    probe_settings = settings.model_copy(update={f"fpl_code_agents_{enabled_field}": True})
    status = await inspect_connection(probe_settings, agent_id)
    if not status["available"]:
        raise HTTPException(409, status["message"])

    def edit(document):
        agents = document.setdefault("code_agents", {})
        agents[enabled_field] = True
        agents[executable_field] = status["executable"]

    if before_publish is not None:
        await before_publish()
    await asyncio.to_thread(replace_config, CONFIG_FILE, expected, edit)
    enabled, executable, _ = connection(get_cloud_settings(), agent_id)
    if not enabled or executable != status["executable"]:
        raise HTTPException(409, "进程环境覆盖了 CLI 配置，请核对部署设置")
