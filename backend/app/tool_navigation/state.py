from __future__ import annotations

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.runtime.ownership import require_owner_id
from app.tool_navigation.models import ToolNavigationItem
from app.tool_navigation.schemas import ToolNavigationItemOut, ToolNavigationStateOut
from studio.runtime.time import iso_utc, utc_now


def _item_out(row: ToolNavigationItem) -> ToolNavigationItemOut:
    return ToolNavigationItemOut(
        tool_id=row.tool_id,
        is_favorite=row.is_favorite,
        favorite_updated_at=(iso_utc(row.favorite_updated_at) if row.favorite_updated_at else None),
        last_used_at=iso_utc(row.last_used_at) if row.last_used_at else None,
        use_count=row.use_count,
    )


class ToolNavigationState:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    @property
    def owner_user_id(self) -> str:
        return require_owner_id(self.session.info.get("owner_user_id"))

    async def list(self) -> ToolNavigationStateOut:
        rows = (
            (
                await self.session.execute(
                    select(ToolNavigationItem).order_by(
                        ToolNavigationItem.last_used_at.desc().nullslast(),
                        ToolNavigationItem.favorite_updated_at.desc().nullslast(),
                        ToolNavigationItem.tool_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        return ToolNavigationStateOut(items=[_item_out(row) for row in rows])

    async def _lock_item(self, tool_id: str, now) -> ToolNavigationItem:
        # Use the account-checked ORM in both deployments. The write lock covers
        # lookup and mutation so a concurrent use cannot overwrite a favorite.
        await self.session.execute(text("BEGIN IMMEDIATE"))
        owner = self.owner_user_id
        row = await self.session.get(ToolNavigationItem, (owner, tool_id), populate_existing=True)
        if row is None:
            row = ToolNavigationItem(
                owner_user_id=owner,
                tool_id=tool_id,
                is_favorite=False,
                use_count=0,
                updated_at=now,
            )
            self.session.add(row)
        return row

    async def set_favorite(self, tool_id: str, *, is_favorite: bool) -> ToolNavigationItemOut:
        now = utc_now()
        row = await self._lock_item(tool_id, now)
        row.is_favorite = is_favorite
        row.favorite_updated_at = now if is_favorite else None
        row.updated_at = now
        await self.session.commit()
        return _item_out(row)

    async def record_use(self, tool_id: str) -> ToolNavigationItemOut:
        now = utc_now()
        row = await self._lock_item(tool_id, now)
        row.use_count += 1
        row.last_used_at = now
        row.updated_at = now
        await self.session.commit()
        return _item_out(row)
