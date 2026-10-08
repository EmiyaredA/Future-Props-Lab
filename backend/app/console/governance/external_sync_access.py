"""Revalidate the persisted sync actor before each external write."""

from sqlalchemy import select

from app.capabilities.identity.permissions import role_permissions
from app.console.governance.workspaces import resolve_access
from app.console.models import ManagementApiKey, User, Workspace
from app.runtime.time import utc_now


async def external_sync_actor_allowed(session, workspace_id: str, actor: dict) -> bool:
    user = await session.get(User, actor["user_id"])
    workspace = await session.get(Workspace, workspace_id)
    if not user or not workspace or user.status != "active" or user.must_change_password:
        return False
    try:
        access, membership = await resolve_access(session, user=user, workspace=workspace)
    except Exception:
        return False
    if "configuration.manage" not in role_permissions(
        access, membership.role if membership else None
    ):
        return False
    if actor.get("auth_kind") == "management_api_key":
        key = await session.scalar(
            select(ManagementApiKey).where(
                ManagementApiKey.id == actor.get("api_key_id"),
                ManagementApiKey.user_id == user.id,
                ManagementApiKey.workspace_id == workspace_id,
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
