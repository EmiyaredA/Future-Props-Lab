"""Revalidate the account recovered from a persisted preview task."""

from studio.apps.identity.storage.models.accounts import User
from studio.contracts.identity.permissions import role_permissions


async def preview_actor_allowed(session, owner):
    user = await session.get(User, owner)
    return bool(
        user
        and user.status == "active"
        and not user.must_change_password
        and "content.write" in role_permissions(user.platform_role)
    )
