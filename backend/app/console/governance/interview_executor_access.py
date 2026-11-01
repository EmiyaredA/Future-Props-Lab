"""Revalidate the account that owns a persisted execution."""

from app.console.models import User


async def interview_actor_allowed(session, owner_user_id, user_id):
    if owner_user_id != user_id:
        return False
    user = await session.get(User, user_id)
    return bool(user and user.status == "active" and not user.must_change_password)
