"""Append-only snapshots; the owning note use case owns commits and CAS."""

from copy import deepcopy
from datetime import UTC

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.thought_workshop.account_directory import author as find_author
from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.models import ThoughtHistoryAsset, ThoughtNote, ThoughtNoteHistory
from app.apps.thought_workshop.schemas.document import file_ids
from app.apps.thought_workshop.schemas.history import (
    ThoughtHistoryDetail,
    ThoughtHistoryList,
    ThoughtHistorySnapshot,
    ThoughtHistorySummary,
)

CONTENT_FIELDS = ("title", "document", "schema_version", "tags")


def snapshot(row: ThoughtNoteHistory) -> ThoughtHistorySnapshot:
    return ThoughtHistorySnapshot.model_validate(row).model_copy(
        update={"created_at": row.created_at.replace(tzinfo=UTC)}
    )


class History:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def append(self, note: ThoughtNote, author_id: str | None, source: str):
        author = await find_author(self.session, author_id)
        row = ThoughtNoteHistory(
            note_id=note.id,
            revision=note.revision,
            **{key: deepcopy(getattr(note, key)) for key in CONTENT_FIELDS},
            author_id=author_id,
            author_name=(author.display_name or author.username) if author else "未知编辑者",
            source=source,
        )
        self.session.add(row)
        await self.session.flush()
        await self.references(row)
        return row

    async def references(self, row: ThoughtNoteHistory):
        self.session.add_all(
            ThoughtHistoryAsset(history_id=row.id, asset_id=asset_id)
            for asset_id in file_ids(row.document)
        )

    async def get(self, note_id: str, history_id: str) -> ThoughtNoteHistory:
        row = await self.session.scalar(
            select(ThoughtNoteHistory).where(
                ThoughtNoteHistory.note_id == note_id, ThoughtNoteHistory.id == history_id
            )
        )
        if row is None:
            raise ThoughtError("历史记录不存在", 404, "not_found")
        return row

    async def list(self, note_id: str, cursor: str | None, limit: int):
        query = select(ThoughtNoteHistory).where(ThoughtNoteHistory.note_id == note_id)
        if cursor:
            anchor = await self.get(note_id, cursor)
            query = query.where(ThoughtNoteHistory.revision < anchor.revision)
        rows = (
            await self.session.scalars(
                query.order_by(ThoughtNoteHistory.revision.desc()).limit(limit + 1)
            )
        ).all()
        items = []
        for i, row in enumerate(rows[:limit]):
            previous = rows[i + 1] if i + 1 < len(rows) else None
            summary = {
                "baseline": "历史起点",
                "create": "创建文档",
                "restore": "还原历史记录",
                "import": "导入文档",
            }.get(row.source)
            if not summary:
                labels = [("title", "标题"), ("document", "正文"), ("tags", "标签")]
                changed = [
                    label
                    for key, label in labels
                    if previous is None or getattr(row, key) != getattr(previous, key)
                ]
                summary = "修改" + "、".join(changed or ["正文格式"])
            items.append(
                ThoughtHistorySummary(
                    **snapshot(row).model_dump(
                        exclude={"document", "schema_version", "tags", "title", "note_id"}
                    ),
                    summary=summary,
                )
            )
        return ThoughtHistoryList(
            items=items, next_cursor=rows[limit - 1].id if len(rows) > limit else None
        )

    async def detail(self, note_id: str, history_id: str):
        row = await self.get(note_id, history_id)
        previous = await self.session.scalar(
            select(ThoughtNoteHistory)
            .where(
                ThoughtNoteHistory.note_id == note_id, ThoughtNoteHistory.revision < row.revision
            )
            .order_by(ThoughtNoteHistory.revision.desc())
            .limit(1)
        )
        return ThoughtHistoryDetail(
            current=snapshot(row), previous=snapshot(previous) if previous else None
        )
