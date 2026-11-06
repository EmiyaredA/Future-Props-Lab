"""Account activity check for website CLI admission and reauthorization."""

from typing import Literal

from sqlalchemy import select

from studio.apps.identity.storage.models.accounts import User
from studio.contracts.agent_runtime.definitions import AgentId

Purpose = Literal["amadeus", "visual_acceptance", "interview_preparation", "agent_workbench"]


async def authorized(session, owner_user_id, user_id, agent_id: AgentId, purpose: Purpose):
    if owner_user_id != user_id or (purpose == "interview_preparation" and agent_id != "codex"):
        return False
    return bool(
        await session.scalar(select(User.id).where(User.id == user_id, User.status == "active"))
    )
