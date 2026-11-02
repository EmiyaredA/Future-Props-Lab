"""Monolith compatibility: authenticate streaming sessions against its local Identity."""

from sqlalchemy import select

from app.console.models import AuthSession, User
from app.runtime.db import SessionLocal
from app.runtime.ownership import bind_owner
from app.runtime.time import utc_now

from .change_stream import event_page as event_page
from .change_stream import stream_events as authenticated_stream


async def valid_auth(db, principal):
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
    now = utc_now()
    return (
        user.status == "active"
        and not user.must_change_password
        and auth.revoked_at is None
        and auth.idle_expires_at > now
        and auth.absolute_expires_at > now
    )


async def stream_events(
    request, principal, after, session_id=None, sessions=SessionLocal, authorizer=None
):
    async def local_authorizer(_request, current):
        async with sessions() as db:
            bind_owner(db, current.user_id)
            return await valid_auth(db, current)

    async for event in authenticated_stream(
        request,
        principal,
        after,
        session_id,
        sessions=sessions,
        authorizer=authorizer or local_authorizer,
    ):
        yield event
