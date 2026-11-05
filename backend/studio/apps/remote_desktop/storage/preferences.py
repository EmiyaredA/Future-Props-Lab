"""Short SQLite preference transactions; identical website and Remote semantics."""

from sqlalchemy import text

from studio.apps.remote_desktop.storage.preference_models import DesktopPreference
from studio.apps.remote_desktop.use_cases.preferences import IdleSnapshot, PreferenceConflict


class PreferenceRecords:
    def __init__(self, sessions):
        self.sessions = sessions

    async def read(self, *, owner):
        async with self.sessions(info={"owner_user_id": owner}) as db:
            row = await db.get(DesktopPreference, owner)
            return IdleSnapshot(row.idle_minutes, row.revision) if row else IdleSnapshot()

    async def compare_and_set(self, *, owner, minutes, expected_revision):
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            row = await db.get(DesktopPreference, owner)
            current = IdleSnapshot(row.idle_minutes, row.revision) if row else IdleSnapshot()
            if current.revision != expected_revision:
                raise PreferenceConflict(current)
            if row is None:
                row = DesktopPreference(owner_user_id=owner)
                db.add(row)
            row.idle_minutes = minutes
            row.revision = expected_revision + 1
            snapshot = IdleSnapshot(row.idle_minutes, row.revision)
            await db.commit()
            return snapshot
