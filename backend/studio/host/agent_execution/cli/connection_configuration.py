"""Local deployment management for shared programming CLI connections."""

import asyncio

from fastapi import HTTPException

from studio.apps.management.config_updates import config_bytes, replace_config, revision
from studio.host.agent_execution.cli.catalog import connection, inspect_connection, settings_prefix


async def enable_connection(agent_id, *, config_file, read_settings, before_publish=None):
    expected = revision(config_bytes(config_file))
    settings = read_settings()
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
    await asyncio.to_thread(replace_config, config_file, expected, edit)
    enabled, executable, _ = connection(read_settings(), agent_id)
    if not enabled or executable != status["executable"]:
        raise HTTPException(409, "进程环境覆盖了 CLI 配置，请核对部署设置")
