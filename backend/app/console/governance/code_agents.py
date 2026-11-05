"""Shared CLI connections for active accounts and their own tasks."""

import asyncio
from typing import Literal

from sqlalchemy import select

from app.capabilities.agents.cli.catalog import DEFINITIONS, AgentId, connection, inspect_connection
from app.capabilities.agents.cli.contracts import AgentOut, CatalogOut
from app.console.models import User
from app.runtime.config import get_cloud_settings
from app.runtime.operation_receipts import OperationError

Purpose = Literal["amadeus", "visual_acceptance", "interview_preparation", "agent_workbench"]


async def authorized(session, owner_user_id, user_id, agent_id: AgentId, purpose: Purpose):
    if owner_user_id != user_id or (purpose == "interview_preparation" and agent_id != "codex"):
        return False
    return bool(
        await session.scalar(select(User.id).where(User.id == user_id, User.status == "active"))
    )


async def resolve(session, owner_user_id, user_id, agent_id, purpose, *, settings=None, probe=True):
    settings = settings or get_cloud_settings()
    if not await authorized(session, owner_user_id, user_id, agent_id, purpose):
        raise OperationError("此账号未获准使用该 Agent", "agent_not_authorized", 403)
    return await resolve_connection(
        agent_id,
        settings=settings,
        probe=probe,
        app_server=purpose in {"amadeus", "agent_workbench"},
    )


async def resolve_connection(agent_id, *, settings=None, probe=True, app_server=True):
    settings = settings or get_cloud_settings()
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


async def catalog(*, can_enable=False):
    settings = get_cloud_settings()
    connections = await asyncio.gather(
        *(inspect_connection(settings, identity) for identity in DEFINITIONS)
    )
    if not can_enable:
        for item in connections:
            item["executable"] = ""
    return CatalogOut(items=[AgentOut(**item) for item in connections], can_enable=can_enable)
