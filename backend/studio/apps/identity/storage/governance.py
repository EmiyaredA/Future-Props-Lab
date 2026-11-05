"""Short SQLite writer transactions for account and membership governance."""

from dataclasses import replace

from sqlalchemy import text, update
from sqlalchemy.ext.asyncio import AsyncSession

from studio.apps.identity.storage.models.accounts import AuthSession, ManagementApiKey, User
from studio.contracts.identity.errors import AccountError
from studio.contracts.identity.permissions import role_scopes
from studio.contracts.identity.principal import StudioPrincipal
from studio.runtime.time import utc_now


async def begin_governance(session: AsyncSession, principal: StudioPrincipal) -> StudioPrincipal:
    # Authentication has only read/settled session activity. Discard its snapshot before
    # acquiring the database writer lock; never carry stale authorization into a write.
    await session.rollback()
    await session.execute(text("BEGIN IMMEDIATE"))
    session.expire_all()
    user = await session.get(User, principal.user_id)
    auth = await session.get(AuthSession, principal.session_id) if principal.session_id else None
    now = utc_now()
    if (
        user is None
        or user.status != "active"
        or user.must_change_password
        or auth is None
        or auth.revoked_at is not None
        or auth.idle_expires_at <= now
        or auth.absolute_expires_at <= now
    ):
        raise AccountError("studio_auth_required")
    if auth.user_id != principal.user_id:
        raise AccountError("studio_auth_required")
    return replace(
        principal,
        platform_role=user.platform_role,
        reauthenticated_at=auth.reauthenticated_at,
        scopes=role_scopes(user.platform_role),
    )


async def cas(session: AsyncSession, model, resource_id: str, revision: int, **values):
    result = await session.execute(
        update(model)
        .where(
            model.id == resource_id,
            model.revision == revision,
        )
        .values(**values, revision=revision + 1, updated_at=utc_now())
    )
    if result.rowcount != 1:
        current = await session.get(model, resource_id, populate_existing=True)
        raise AccountError("revision_conflict", current=current)
    return await session.get(model, resource_id, populate_existing=True)


async def revoke_account_credentials(session: AsyncSession, user_id: str) -> None:
    now = utc_now()
    await session.execute(
        update(AuthSession)
        .where(
            AuthSession.user_id == user_id,
            AuthSession.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )
    await session.execute(
        update(ManagementApiKey)
        .where(
            ManagementApiKey.user_id == user_id,
            ManagementApiKey.revoked_at.is_(None),
        )
        .values(revoked_at=now, revision=ManagementApiKey.revision + 1)
    )


def require_platform_admin(principal: StudioPrincipal) -> None:
    if principal.auth_kind != "session" or not principal.is_platform_admin:
        raise AccountError("platform_admin_required")
