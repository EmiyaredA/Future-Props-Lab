"""Identity account initialization records work without writing another service's database."""

from sqlalchemy import select, update

from app.console.governance.account_creation import create_account as create_account_record
from app.console.models.accounts import User
from studio.apps.identity.storage.service_models import AccountEvent
from studio.runtime.time import utc_now


async def catalog_initialization(session, user_id, role):
    session.add(
        AccountEvent(
            user_id=user_id,
            event_type="account.created",
            payload={"user_id": user_id, "platform_role": role},
        )
    )
    await session.flush()


async def create_account(session, **values):
    return await create_account_record(session, initializer=catalog_initialization, **values)


async def pending_catalog_events(session, *, limit=100):
    rows = await session.execute(
        select(AccountEvent, User.platform_role, User.revision)
        .join(User, User.id == AccountEvent.user_id)
        .where(AccountEvent.delivered_at.is_(None), User.status == "active")
        .order_by(AccountEvent.created_at, AccountEvent.id)
        .limit(limit)
    )
    return [
        {
            "event": {
                "id": row.id,
                "type": row.event_type,
                "payload": row.payload,
                "revision": row.revision,
            },
            "account": {"user_id": row.user_id, "platform_role": role, "revision": revision},
        }
        for row, role, revision in rows
    ]


async def acknowledge_catalog_event(session, event_id, revision):
    result = await session.execute(
        update(AccountEvent)
        .where(
            AccountEvent.id == event_id,
            AccountEvent.revision == revision,
            AccountEvent.delivered_at.is_(None),
        )
        .values(delivered_at=utc_now(), revision=revision + 1)
    )
    if result.rowcount == 1:
        await session.commit()
        return True
    row = await session.get(AccountEvent, event_id)
    return bool(row and row.delivered_at is not None and row.revision == revision + 1)
