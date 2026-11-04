"""Desktop-owned account preferences and revision checks."""

from fastapi import HTTPException
from sqlalchemy import text

from .preference_models import DesktopPreference


async def desktop_preferences(db, owner):
    row = await db.get(DesktopPreference, owner)
    return (row.idle_minutes, row.revision) if row else (30, 0)


async def save_desktop_preferences(db, owner, body):
    await db.rollback()
    await db.execute(text("BEGIN IMMEDIATE"))
    current, revision = await desktop_preferences(db, owner)
    if revision != body.revision:
        raise HTTPException(
            409,
            detail={
                "code": "revision_conflict",
                "message": "锁定时限已变更",
                "current": {"idle_minutes": current, "revision": revision},
            },
        )
    row = await db.get(DesktopPreference, owner)
    if row is None:
        row = DesktopPreference(owner_user_id=owner)
        db.add(row)
    row.idle_minutes, row.revision = body.idle_minutes, revision + 1
    await db.commit()
    return row.idle_minutes, row.revision
