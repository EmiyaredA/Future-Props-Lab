"""Revalidate the persisted sync actor before each external write."""

from sqlalchemy import select

from studio.apps.identity.storage.models.accounts import ManagementApiKey, User
from studio.runtime.time import utc_now


async def external_sync_actor_allowed(session, owner_user_id: str, actor: dict) -> bool:
    user = await session.get(User, actor["user_id"])
    if not user or user.id != owner_user_id or user.status != "active" or user.must_change_password:
        return False
    if actor.get("auth_kind") == "management_api_key":
        key = await session.scalar(
            select(ManagementApiKey).where(
                ManagementApiKey.id == actor.get("api_key_id"),
                ManagementApiKey.user_id == user.id,
            )
        )
        if (
            not key
            or key.revoked_at
            or key.expires_at <= utc_now()
            or "studio:write" not in key.scopes
        ):
            return False
    return True
