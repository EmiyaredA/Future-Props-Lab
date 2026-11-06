"""Write a purpose-specific cloud grant in the active Studio session."""

from sqlalchemy import select, text

from studio.apps.identity.storage.cloud_access import allowed, session_query
from studio.apps.identity.storage.models.accounts import AuthSession
from studio.apps.identity.storage.models.cloud import CloudUnlock
from studio.apps.identity.use_cases.cloud_unlock import CloudUnlockError, unlock_deadline
from studio.contracts.identity.cloud_unlock import CloudUnlockPurpose
from studio.contracts.identity.principal import StudioPrincipal


class CloudUnlockRecords:
    def __init__(self, sessions, *, clock, settings_reader):
        self.sessions = sessions
        self.clock = clock
        self.settings_reader = settings_reader

    async def grant(
        self, principal: StudioPrincipal, purpose: CloudUnlockPurpose, *, local: bool
    ) -> None:
        desktop = purpose == "desktop"
        async with self.sessions() as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            if not allowed(
                principal, local=local, desktop=desktop, settings=self.settings_reader()
            ) or (desktop and local):
                raise CloudUnlockError(
                    403, "cloud_unlock_forbidden", "该账号或入口未启用此云控解锁"
                )
            now = self.clock()
            session = await db.scalar(
                select(AuthSession).where(AuthSession.id.in_(session_query(principal, now=now)))
            )
            if principal.auth_kind != "session" or session is None:
                raise CloudUnlockError(401, "studio_auth_required", "账号会话已失效")
            deadline = unlock_deadline(now, session.created_at, session.reauthenticated_at)
            unlock = await db.get(CloudUnlock, session.id)
            if unlock is None:
                unlock = CloudUnlock(
                    session_id=session.id,
                    owner_user_id=principal.user_id,
                    expires_at=0,
                    ticket_until=0,
                )
                db.add(unlock)
            if desktop:
                unlock.desktop_verified = True
            else:
                unlock.expires_at = deadline
            await db.commit()
