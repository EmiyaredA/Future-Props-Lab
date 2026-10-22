"""Account and membership revalidation for an already-bound local executor."""

from app.capabilities.identity.permissions import role_permissions
from app.console.governance.workspaces import resolve_access
from app.console.models import User, Workspace


async def interview_actor_allowed(session, workspace_id: str, user_id: str) -> bool:
    user = await session.get(User, user_id)
    workspace = await session.get(Workspace, workspace_id)
    if not user or not workspace or user.status != "active" or user.must_change_password:
        return False
    try:
        access, membership = await resolve_access(session, user=user, workspace=workspace)
    except Exception:
        return False
    return "content.write" in role_permissions(access, membership.role if membership else None)
