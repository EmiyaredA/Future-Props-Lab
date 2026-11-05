"""Key-bounded revisioned storage inside an existing application transaction."""

from collections.abc import Callable
from copy import deepcopy

from sqlalchemy import update

from studio.runtime.database.settings_models import PlatformSetting
from studio.runtime.time import utc_now


class SettingConflict(Exception):
    def __init__(self, current):
        self.current = current
        super().__init__("setting revision conflict")


class SettingsPartition:
    """Mechanism only: the owner supplies its key policy and transaction boundary.

    Authorization and any related audit/catalog writes must share the caller's
    transaction. This adapter never commits. Creation requires that transaction's
    writer lock; replacement additionally checks the revision in SQL. Returned
    payloads are detached copies so callers cannot mutate an ORM JSON value.
    """

    def __init__(self, session, *, accepts: Callable[[str], bool]):
        self.session, self.accepts = session, accepts

    def _check(self, key):
        if not self.accepts(key):
            raise ValueError("Setting key is outside this application's partition")

    async def read(self, key, default):
        self._check(key)
        row = await self.session.get(PlatformSetting, key, populate_existing=True)
        return {
            "revision": row.revision if row else 0,
            "value": deepcopy(row.payload if row else default),
        }

    async def replace(self, key, value, *, expected_revision):
        self._check(key)
        row = await self.session.get(PlatformSetting, key, populate_existing=True)
        if row is None:
            if expected_revision != 0:
                raise SettingConflict({"revision": 0, "value": {}})
            self.session.add(PlatformSetting(id=key, payload=deepcopy(value), revision=1))
            await self.session.flush()
        else:
            changed = await self.session.execute(
                update(PlatformSetting)
                .where(PlatformSetting.id == key, PlatformSetting.revision == expected_revision)
                .values(
                    payload=deepcopy(value), revision=expected_revision + 1, updated_at=utc_now()
                )
            )
            if changed.rowcount != 1:
                raise SettingConflict(await self.read(key, {}))
        return {"revision": expected_revision + 1, "value": deepcopy(value)}
