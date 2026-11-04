"""Legacy collector authorization; independent Agents obtains this decision from Identity."""

from app.capabilities.identity.permissions import CLOUD_CONTROL_PERMISSION, role_permissions
from app.console.models.accounts import User


async def workbench_actor_allowed(session, owner_user_id: str) -> bool:
    user = await session.get(User, owner_user_id)
    return bool(
        user
        and user.status == "active"
        and not user.must_change_password
        and CLOUD_CONTROL_PERMISSION in role_permissions(user.platform_role)
    )
