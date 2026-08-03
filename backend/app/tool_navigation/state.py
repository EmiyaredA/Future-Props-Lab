from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import iso_utc, utc_now
from app.models import ToolNavigationItem
from app.schemas.tool_navigation import ToolNavigationItemOut, ToolNavigationStateOut


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

    async def set_favorite(self, tool_id: str, *, is_favorite: bool) -> ToolNavigationItemOut:
        now = utc_now()
        favorite_updated_at = now if is_favorite else None
        statement = insert(ToolNavigationItem).values(
            tool_id=tool_id,
            is_favorite=is_favorite,
            favorite_updated_at=favorite_updated_at,
            use_count=0,
            updated_at=now,
        )
        await self.session.execute(
            statement.on_conflict_do_update(
                index_elements=[ToolNavigationItem.tool_id],
                set_={
                    "is_favorite": is_favorite,
                    "favorite_updated_at": favorite_updated_at,
                    "updated_at": now,
                },
            )
        )
        await self.session.commit()
        return await self._get(tool_id)

    async def record_use(self, tool_id: str) -> ToolNavigationItemOut:
        now = utc_now()
        statement = insert(ToolNavigationItem).values(
            tool_id=tool_id,
            is_favorite=False,
            last_used_at=now,
            use_count=1,
            updated_at=now,
        )
        await self.session.execute(
            statement.on_conflict_do_update(
                index_elements=[ToolNavigationItem.tool_id],
                set_={
                    "last_used_at": now,
                    "use_count": ToolNavigationItem.use_count + 1,
                    "updated_at": now,
                },
            )
        )
        await self.session.commit()
        return await self._get(tool_id)

    async def _get(self, tool_id: str) -> ToolNavigationItemOut:
        row = await self.session.get(ToolNavigationItem, tool_id)
        if row is None:  # pragma: no cover - protected by the upsert paths
            raise RuntimeError("工具状态写入失败")
        return _item_out(row)
