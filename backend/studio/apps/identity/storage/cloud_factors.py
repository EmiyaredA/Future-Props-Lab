"""SQLite factor transaction shared by website and independent Identity.

Only this adapter sees AuthSession and factor ORM. No HTTP request or mutable
Session escapes the operation. A rejected code is a committed decision, while
an authorization failure, exception or cancellation rolls back the transaction.
"""

from dataclasses import asdict

from sqlalchemy import delete, select, text

from studio.apps.identity.storage.models.accounts import AuthSession, User
from studio.apps.identity.storage.models.cloud import CloudFactor, CloudUnlock
from studio.apps.identity.use_cases.cloud_factors import FactorError, FactorSnapshot


class FactorRecords:
    def __init__(self, sessions, *, clock):
        self.sessions = sessions
        self.clock = clock

    async def update(self, principal, decide, *, public):
        async with self.sessions() as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            now = self.clock()
            query = (
                select(AuthSession)
                .join(User, User.id == AuthSession.user_id)
                .where(
                    AuthSession.id == principal.session_id,
                    AuthSession.user_id == principal.user_id,
                    AuthSession.revoked_at.is_(None),
                    AuthSession.idle_expires_at > now,
                    AuthSession.absolute_expires_at > now,
                    User.status == "active",
                    User.platform_role == "admin",
                    User.must_change_password.is_(False),
                )
            )
            session = await db.scalar(query)
            if principal.auth_kind != "session" or session is None:
                raise FactorError(401, "账号会话已失效")
            if public and not (
                session.reauthenticated_at and session.reauthenticated_at > session.created_at
            ):
                raise FactorError(
                    403, {"code": "reauthentication_required", "message": "请重新验证密码"}
                )
            row = await db.get(CloudFactor, principal.user_id)
            current = (
                FactorSnapshot(
                    **{name: getattr(row, name) for name in FactorSnapshot.__dataclass_fields__}
                )
                if row is not None
                else None
            )
            decision = decide(current)
            if decision.factor is not None:
                if row is None:
                    row = CloudFactor(owner_user_id=principal.user_id)
                    db.add(row)
                for name, value in asdict(decision.factor).items():
                    setattr(row, name, value)
            if decision.revoke_unlocks:
                await db.execute(
                    delete(CloudUnlock).where(CloudUnlock.owner_user_id == principal.user_id)
                )
            if decision.desktop or decision.unlock_until is not None:
                unlock = await db.get(CloudUnlock, principal.session_id)
                if unlock is None:
                    unlock = CloudUnlock(
                        session_id=principal.session_id,
                        owner_user_id=principal.user_id,
                        expires_at=0,
                    )
                    db.add(unlock)
                if decision.desktop:
                    unlock.desktop_verified = True
                else:
                    unlock.expires_at = decision.unlock_until
                unlock.ticket_hash, unlock.ticket_until = None, 0
            await db.commit()
            return decision
