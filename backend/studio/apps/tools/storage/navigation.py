"""Atomic, account-bound navigation mutations for both SQLite assemblies."""

from sqlalchemy import select, text

from studio.apps.tools.storage.navigation_models import ToolNavigationItem
from studio.contracts.tools.navigation import ToolNavigationItemOut, ToolNavigationStateOut
from studio.runtime.time import iso_utc


def _snapshot(row):
    return ToolNavigationItemOut(
        tool_id=row.tool_id,
        is_favorite=row.is_favorite,
        favorite_updated_at=iso_utc(row.favorite_updated_at) if row.favorite_updated_at else None,
        last_used_at=iso_utc(row.last_used_at) if row.last_used_at else None,
        use_count=row.use_count,
    )


class NavigationRecords:
    def __init__(self, sessions):
        self.sessions = sessions

    async def list(self, *, owner):
        async with self.sessions(info={"owner_user_id": owner}) as session:
            rows = await session.scalars(
                select(ToolNavigationItem)
                .where(ToolNavigationItem.owner_user_id == owner)
                .order_by(
                    ToolNavigationItem.last_used_at.desc().nullslast(),
                    ToolNavigationItem.favorite_updated_at.desc().nullslast(),
                    ToolNavigationItem.tool_id,
                )
            )
            return ToolNavigationStateOut(items=[_snapshot(row) for row in rows])

    async def _change(self, *, owner, tool_id, at, favorite):
        # Each operation owns its session and short write lock. Lookup and mutation
        # commit together; exception/cancellation closes the session and rolls back.
        async with self.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await session.get(ToolNavigationItem, (owner, tool_id))
            if row is None:
                row = ToolNavigationItem(
                    owner_user_id=owner, tool_id=tool_id, is_favorite=False, use_count=0
                )
                session.add(row)
            if favorite is None:
                row.use_count += 1
                row.last_used_at = at
            else:
                row.is_favorite = favorite
                row.favorite_updated_at = at if favorite else None
            row.updated_at = at
            await session.commit()
            return _snapshot(row)

    async def set_favorite(self, *, owner, tool_id, is_favorite, at):
        return await self._change(owner=owner, tool_id=tool_id, at=at, favorite=is_favorite)

    async def record_use(self, *, owner, tool_id, at):
        return await self._change(owner=owner, tool_id=tool_id, at=at, favorite=None)
