"""Owned I/O adapter; protocol composition stays at the entrypoint."""

from sqlalchemy import select

from studio.apps.identity.storage.models.accounts import AuthSession, ManagementApiKey, User
from studio.contracts.identity.permissions import role_scopes
from studio.runtime.time import utc_now


async def active_actor(session, actor):
    user = await session.get(User, actor.user_id)
    if (
        user is None
        or user.status != "active"
        or user.must_change_password
        or user.platform_role != actor.platform_role
    ):
        return False
    now = utc_now()
    scopes = role_scopes(user.platform_role)
    if actor.auth_kind == "session":
        auth = await session.get(AuthSession, actor.session_id)
        active = bool(
            auth
            and auth.user_id == actor.user_id
            and auth.revoked_at is None
            and auth.idle_expires_at > now
            and auth.absolute_expires_at > now
            and (await session.scalar(select(AuthSession.purpose).where(AuthSession.id == auth.id)))
            == actor.purpose
        )
    else:
        key = await session.get(ManagementApiKey, actor.api_key_id)
        active = bool(
            key and key.user_id == actor.user_id and key.revoked_at is None and key.expires_at > now
        )
        key_scopes = set(key.scopes) if key else set()
        if "studio:write" in key_scopes:
            key_scopes.add("studio:read")
        if "studio:read" in key_scopes:
            key_scopes.add("studio:private_read")
        scopes = key_scopes & scopes
    return active and set(actor.scopes) == set(scopes)


async def task_authorization(session, owner, permission):
    from studio.contracts.identity.permissions import role_permissions

    user = await session.get(User, owner)
    allowed = bool(
        user
        and user.status == "active"
        and not user.must_change_password
        and permission in role_permissions(user.platform_role)
    )
    return {"allowed": allowed, "revision": user.revision if user else None}
