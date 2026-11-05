"""Identity-owned live Session checks for compatibility Workbench subscriptions."""

from sqlalchemy import select

from studio.apps.identity.storage.models.accounts import AuthSession, User
from studio.runtime.database.ownership import bind_owner


async def valid_auth(db, principal, clock):
    if not principal.session_id:
        return False
    row = (
        await db.execute(
            select(AuthSession, User)
            .join(User, User.id == AuthSession.user_id)
            .where(AuthSession.id == principal.session_id, User.id == principal.user_id)
        )
    ).first()
    if not row:
        return False
    auth, user = row
    now = clock()
    return (
        user.status == "active"
        and user.platform_role == "admin"
        and not user.must_change_password
        and auth.revoked_at is None
        and auth.idle_expires_at > now
        and auth.absolute_expires_at > now
    )


class WorkbenchStreamAuthorization:
    def __init__(self, sessions, *, clock):
        self.sessions, self.clock = sessions, clock

    async def check(self, _request, principal):
        async with self.sessions() as db:
            bind_owner(db, principal.user_id)
            return await valid_auth(db, principal, self.clock)
