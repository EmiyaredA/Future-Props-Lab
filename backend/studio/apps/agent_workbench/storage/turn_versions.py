"""Short, account-bound version snapshots for either website assembly."""

from studio.runtime.database.ownership import bind_owner


class SqlTurnVersions:
    def __init__(self, sessions, *, load, readiness):
        self.sessions, self.load, self.readiness = sessions, load, readiness

    async def read(self, owner, chat_id):
        async with self.sessions() as db:
            bind_owner(db, owner)
            version = await self.load(db, owner, chat_id)
        # Process-local readiness is advisory and never held inside a SQL transaction.
        return version, self.readiness(owner, chat_id, version)
