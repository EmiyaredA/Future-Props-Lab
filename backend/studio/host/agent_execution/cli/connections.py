"""Probe fixed CLI connections using the deployment snapshot supplied by assembly."""

import asyncio

from studio.contracts.agent_runtime.catalog import AgentOut, CatalogOut
from studio.host.agent_execution.cli.catalog import DEFINITIONS, connection, inspect_connection
from studio.runtime.database.operation_receipts import OperationError


async def resolve_connection(agent_id, *, settings, probe=True, app_server=True):
    enabled, path, error = connection(settings, agent_id)
    if error or not enabled or not path:
        raise OperationError(error or "Agent 尚未配置", "agent_unavailable", 409)
    if probe:
        status = await inspect_connection(
            settings, agent_id, discover_models=False, app_server=app_server
        )
        if not status["available"]:
            raise OperationError(status["message"], status["status"], 409)
    return path


async def catalog(*, settings, can_enable=False):
    connections = await asyncio.gather(
        *(
            inspect_connection(settings, identity, probe_disabled=can_enable)
            for identity in DEFINITIONS
        )
    )
    if not can_enable:
        for item in connections:
            item["executable"] = ""
    return CatalogOut(items=[AgentOut(**item) for item in connections], can_enable=can_enable)
