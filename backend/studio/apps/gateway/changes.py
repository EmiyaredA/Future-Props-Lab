"""Persist notifications without reading application databases or private project contents."""

from fastapi import HTTPException
from sqlalchemy import text

from studio.apps.gateway.storage.service_models import ChangeCursor, ChangeReceipt


async def revision(database, owner):
    async with database.sessions() as session:
        session.info["owner_user_id"] = owner
        row = await session.get(ChangeCursor, owner)
        return row.revision if row else 0


async def receive(database, *, service, event_id, owner):
    async with database.sessions() as session:
        session.info["owner_user_id"] = owner
        await session.execute(text("BEGIN IMMEDIATE"))
        receipt = await session.get(ChangeReceipt, (service, event_id))
        if receipt is not None:
            return receipt.revision
        # Check the global receipt key independently of the body-supplied owner.
        existing = (
            (
                await session.execute(
                    ChangeReceipt.__table__.select().where(
                        ChangeReceipt.__table__.c.service_id == service,
                        ChangeReceipt.__table__.c.event_id == event_id,
                    )
                )
            )
            .mappings()
            .first()
        )
        if existing is not None:
            raise HTTPException(409, "change_event_owner_conflict")
        cursor = await session.get(ChangeCursor, owner)
        if cursor is None:
            cursor = ChangeCursor(owner_user_id=owner, revision=0)
            session.add(cursor)
        cursor.revision += 1
        session.add(
            ChangeReceipt(
                service_id=service,
                event_id=event_id,
                owner_user_id=owner,
                revision=cursor.revision,
            )
        )
        await session.commit()
        return cursor.revision
