"""Authorize website CLI operations through the Identity account port."""

from studio.apps.identity.website_access.code_agents import authorized
from studio.host.agent_execution.cli.connections import resolve_connection
from studio.runtime.database.operation_receipts import OperationError


async def resolve(session, owner_user_id, user_id, agent_id, purpose, *, settings, probe=True):
    if not await authorized(session, owner_user_id, user_id, agent_id, purpose):
        raise OperationError("此账号未获准使用该 Agent", "agent_not_authorized", 403)
    return await resolve_connection(
        agent_id,
        settings=settings,
        probe=probe,
        app_server=purpose in {"amadeus", "agent_workbench"},
    )
