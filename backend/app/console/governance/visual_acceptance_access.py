"""Revalidate an acceptance task's submitting actor before external execution."""

from app.capabilities.identity.permissions import role_permissions
from app.console.governance.workspaces import resolve_access
from app.console.models import User, Workspace


async def acceptance_actor_allowed(session, workspace_id, user_id):
    user = await session.get(User, user_id)
    workspace = await session.get(Workspace, workspace_id)
    if not user or not workspace or user.status != "active" or user.must_change_password:
        return False
    try:
        access, membership = await resolve_access(session, user=user, workspace=workspace)
        permissions = role_permissions(access, membership.role if membership else None)
        return {"content.write", "models.use"} <= permissions
    except Exception:
        return False
