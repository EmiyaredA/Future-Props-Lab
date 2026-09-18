from __future__ import annotations

from pathlib import Path

from sqlalchemy import Text, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.history import CONTENT_FIELDS, History
from app.apps.thought_workshop.knowledge import KnowledgeBases
from app.apps.thought_workshop.models import (
    ThoughtKnowledgeBase,
    ThoughtNote,
    ThoughtNoteAsset,
)
from app.apps.thought_workshop.schemas.document import (
    attachment_nodes,
    document_text,
    file_ids,
    image_ids,
)
from app.apps.thought_workshop.schemas.workshop import (
    ThoughtNoteIn,
    ThoughtNoteList,
    ThoughtNoteOut,
    ThoughtNotePut,
    ThoughtNoteSummary,
)
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.policy import ATTACHMENT_EXTENSIONS
from app.runtime.operation_receipts import forget
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import utc_now


def note_out(row: ThoughtNote) -> ThoughtNoteOut:
    return ThoughtNoteOut(
        **{key: getattr(row, key) for key in ThoughtNoteOut.model_fields if key != "excerpt"},
        excerpt=row.search_text[:240],
    )


class Notes:
    def __init__(self, session: AsyncSession, workspace_id: str, author_id: str | None = None):
        self.session = session
        self.workspace_id = workspace_id
        self.author_id = author_id

    async def get(self, note_id: str) -> ThoughtNote:
        row = await self.session.scalar(
            select(ThoughtNote)
            .where(
                ThoughtNote.id == note_id,
                ThoughtNote.workspace_id == self.workspace_id,
            )
            .execution_options(populate_existing=True)
        )
        if row is None:
            raise ThoughtError("笔记不存在", 404, "not_found")
        await KnowledgeBases(self.session, self.workspace_id).get(row.knowledge_base_id)
        return row

    async def list(
        self,
        *,
        query: str = "",
        knowledge_base_id: str,
        parent_id: str = "",
        tag: str = "",
        view: str = "all",
        sort: str = "updated",
        offset: int = 0,
        limit: int = 40,
    ) -> ThoughtNoteList:
        await KnowledgeBases(self.session, self.workspace_id).get(knowledge_base_id)
        filters = [
            ThoughtNote.knowledge_base_id == knowledge_base_id,
            ThoughtNote.is_home.is_(False),
            ThoughtNote.workspace_id == self.workspace_id,
            ThoughtNote.deleted_at.is_not(None)
            if view == "trash"
            else ThoughtNote.deleted_at.is_(None),
        ]
        if parent_id:
            filters.append(
                ThoughtNote.parent_id.is_(None)
                if parent_id == "unfiled"
                else ThoughtNote.parent_id == parent_id
            )
        if view == "favorites":
            filters.append(ThoughtNote.favorite.is_(True))
        if view == "pinned":
            filters.append(ThoughtNote.pinned.is_(True))
        if query.strip():
            q = query.strip()
            filters.append(
                or_(
                    ThoughtNote.title.contains(q, autoescape=True),
                    ThoughtNote.search_text.contains(q, autoescape=True),
                    ThoughtNote.tags.cast(Text).contains(q, autoescape=True),
                )
            )
        if tag:
            tag_values = func.json_each(ThoughtNote.tags).table_valued("value")
            filters.append(
                select(1).select_from(tag_values).where(tag_values.c.value == tag).exists()
            )
        total = await self.session.scalar(
            select(func.count()).select_from(ThoughtNote).where(*filters)
        )
        order = ThoughtNote.title.asc() if sort == "title" else ThoughtNote.updated_at.desc()
        rows = (
            await self.session.scalars(
                select(ThoughtNote)
                .where(*filters)
                .order_by(
                    ThoughtNote.pinned.desc(),
                    order,
                    ThoughtNote.id,
                )
                .offset(offset)
                .limit(limit)
            )
        ).all()
        all_tags = (
            await self.session.scalars(
                select(ThoughtNote.tags).where(
                    ThoughtNote.workspace_id == self.workspace_id,
                    ThoughtNote.knowledge_base_id == knowledge_base_id,
                    ThoughtNote.deleted_at.is_(None),
                )
            )
        ).all()
        return ThoughtNoteList(
            items=[ThoughtNoteSummary(**note_out(r).model_dump()) for r in rows],
            total=total or 0,
            tags=sorted({t for tags in all_tags for t in tags}),
        )

    async def validate_refs(self, body: ThoughtNoteIn, *, importing: bool = False) -> set[str]:
        await KnowledgeBases(self.session, self.workspace_id).get(
            body.knowledge_base_id, include_deleted=importing
        )
        if body.parent_id and not importing:
            parent = await self.session.scalar(
                select(ThoughtNote).where(
                    ThoughtNote.id == body.parent_id,
                    ThoughtNote.knowledge_base_id == body.knowledge_base_id,
                    ThoughtNote.workspace_id == self.workspace_id,
                    ThoughtNote.is_home.is_(False),
                    ThoughtNote.deleted_at.is_(None),
                )
            )
            if parent is None:
                raise ThoughtError("父文档不存在", 404, "not_found")
        ids = file_ids(body.document)
        images = image_ids(body.document)
        body.schema_version = 2
        if ids:
            rows = (
                await self.session.scalars(
                    select(VisualAsset).where(
                        VisualAsset.id.in_(ids),
                        VisualAsset.workspace_id == self.workspace_id,
                        VisualAsset.project_id.is_(None),
                        VisualAsset.galgame_project_id.is_(None),
                        VisualAsset.video_editor_project_id.is_(None),
                    )
                )
            ).all()
            if {r.id for r in rows} != ids:
                raise ThoughtError("文件不存在或不属于当前空间的公共文件", 404, "not_found")
            assets = {row.id: row for row in rows}
            if any(assets[key].media_kind != "image" for key in images):
                raise ThoughtError("图片引用必须为图片文件")
            for node in attachment_nodes(body.document):
                row = assets[node["attrs"]["assetId"]]
                if Path(row.original_filename).suffix.lower() not in ATTACHMENT_EXTENSIONS:
                    raise ThoughtError("不支持此附件类型")
                node["attrs"] = {
                    "assetId": row.id,
                    "filename": row.original_filename,
                    "mimeType": row.mime_type,
                    "byteSize": row.byte_size,
                }
        return ids

    async def references(self, note_id: str, ids: set[str]) -> None:
        await self.session.execute(
            delete(ThoughtNoteAsset).where(ThoughtNoteAsset.note_id == note_id)
        )
        self.session.add_all(
            ThoughtNoteAsset(note_id=note_id, asset_id=asset_id) for asset_id in ids
        )

    async def create(
        self,
        body: ThoughtNoteIn,
        *,
        commit: bool = True,
        importing: bool = False,
        note_id: str | None = None,
    ) -> ThoughtNote:
        ids = await self.validate_refs(body, importing=importing)
        row = ThoughtNote(
            workspace_id=self.workspace_id,
            **body.model_dump(),
            search_text=document_text(body.document),
        )
        if note_id:
            row.id = note_id
        self.session.add(row)
        await self.session.flush()
        await self.references(row.id, ids)
        if not importing:
            await History(self.session).append(row, self.author_id, "create")
        if commit:
            await self.session.commit()
            await self.session.refresh(row)
        return row

    async def put(
        self, note_id: str, body: ThoughtNotePut, *, restoring: bool = False, commit: bool = True
    ) -> ThoughtNoteOut:
        current = await self.get(note_id)
        if current.deleted_at:
            raise ThoughtError("请先恢复笔记", 409, "note_deleted")
        if current.revision != body.expected_revision:
            await self.conflict(note_id, body.expected_revision)
        if (
            current.knowledge_base_id != body.knowledge_base_id
            or current.parent_id != body.parent_id
        ):
            raise ThoughtError("请使用目录移动操作修改文档归属")
        ids = await self.validate_refs(body)
        content_changed = any(getattr(current, key) != getattr(body, key) for key in CONTENT_FIELDS)
        values = body.model_dump(exclude={"expected_revision", "knowledge_base_id", "parent_id"})
        values.update(
            search_text=document_text(body.document),
            revision=body.expected_revision + 1,
            updated_at=utc_now(),
        )
        result = await self.session.execute(
            update(ThoughtNote)
            .where(
                ThoughtNote.id == note_id,
                ThoughtNote.workspace_id == self.workspace_id,
                ThoughtNote.revision == body.expected_revision,
                ThoughtNote.deleted_at.is_(None),
            )
            .values(**values)
        )
        if result.rowcount != 1:
            await self.conflict(note_id, body.expected_revision)
        await self.references(note_id, ids)
        if content_changed or restoring:
            await History(self.session).append(
                await self.get(note_id), self.author_id, "restore" if restoring else "edit"
            )
        await self.session.execute(
            update(ThoughtKnowledgeBase)
            .where(ThoughtKnowledgeBase.id == current.knowledge_base_id)
            .values(updated_at=utc_now())
        )
        if commit:
            await self.session.commit()
        return note_out(await self.get(note_id))

    async def history_list(self, note_id: str, cursor: str | None, limit: int):
        await self.get(note_id)
        return await History(self.session).list(note_id, cursor, limit)

    async def history_detail(self, note_id: str, history_id: str):
        await self.get(note_id)
        return await History(self.session).detail(note_id, history_id)

    async def restore_history(self, note_id: str, history_id: str, expected: int):
        current = await self.get(note_id)
        selected = await History(self.session).get(note_id, history_id)
        body = ThoughtNotePut(
            **{
                key: getattr(current, key)
                for key in ThoughtNoteIn.model_fields
                if key not in CONTENT_FIELDS
            },
            **{key: getattr(selected, key) for key in CONTENT_FIELDS},
            expected_revision=expected,
        )
        return await self.put(note_id, body, restoring=True)

    async def conflict(self, note_id: str, expected: int) -> None:
        await self.session.rollback()
        current = note_out(await self.get(note_id))
        raise RevisionConflictError(expected, current.revision, current.model_dump(mode="json"))

    async def _descendant_ids(self, note: ThoughtNote) -> list[str]:
        pending = [note.id]
        found: list[str] = []
        seen = {note.id}
        while pending:
            parent = pending.pop()
            children = (
                await self.session.scalars(
                    select(ThoughtNote.id).where(
                        ThoughtNote.knowledge_base_id == note.knowledge_base_id,
                        ThoughtNote.parent_id == parent,
                        ThoughtNote.is_home.is_(False),
                        ThoughtNote.deleted_at.is_(None),
                    )
                )
            ).all()
            for child_id in children:
                if child_id in seen:
                    continue
                seen.add(child_id)
                found.append(child_id)
                pending.append(child_id)
        return found

    async def transition(
        self,
        note_id: str,
        expected: int,
        action: str,
        expected_knowledge: int,
        *,
        cascade_children: bool = False,
    ) -> ThoughtNoteOut:
        row = await self.get(note_id)
        if row.is_home:
            raise ThoughtError("首页不能单独删除或恢复")
        await KnowledgeBases(self.session, self.workspace_id).reserve(
            row.knowledge_base_id, expected_knowledge
        )
        snapshot = note_out(row)
        if action == "purge" and row.deleted_at is None:
            raise ThoughtError("只能永久删除回收站笔记")
        predicate = (
            ThoughtNote.id == note_id,
            ThoughtNote.workspace_id == self.workspace_id,
            ThoughtNote.revision == expected,
        )
        if action == "purge":
            result = await self.session.execute(delete(ThoughtNote).where(*predicate))
            if result.rowcount != 1:
                await self.conflict(note_id, expected)
            await forget(
                self.session, workspace_id=self.workspace_id, kind="thought", resource_id=note_id
            )
            await self.session.commit()
            return snapshot
        if action == "restore":
            result = await self.session.execute(
                update(ThoughtNote)
                .where(*predicate)
                .values(deleted_at=None, updated_at=utc_now(), revision=expected + 1)
            )
            if result.rowcount != 1:
                await self.conflict(note_id, expected)
            await self.session.commit()
            return note_out(await self.get(note_id))

        parent_id = row.parent_id
        if cascade_children:
            targets = [note_id, *await self._descendant_ids(row)]
        else:
            await self.session.execute(
                update(ThoughtNote)
                .where(
                    ThoughtNote.knowledge_base_id == row.knowledge_base_id,
                    ThoughtNote.parent_id == note_id,
                    ThoughtNote.deleted_at.is_(None),
                )
                .values(
                    parent_id=parent_id,
                    revision=ThoughtNote.revision + 1,
                    updated_at=utc_now(),
                )
            )
            targets = [note_id]
        result = await self.session.execute(
            update(ThoughtNote)
            .where(
                ThoughtNote.id == note_id,
                ThoughtNote.workspace_id == self.workspace_id,
                ThoughtNote.revision == expected,
                ThoughtNote.deleted_at.is_(None),
            )
            .values(deleted_at=utc_now(), updated_at=utc_now(), revision=expected + 1)
        )
        if result.rowcount != 1:
            await self.conflict(note_id, expected)
        if len(targets) > 1:
            await self.session.execute(
                update(ThoughtNote)
                .where(
                    ThoughtNote.id.in_(targets[1:]),
                    ThoughtNote.workspace_id == self.workspace_id,
                    ThoughtNote.deleted_at.is_(None),
                )
                .values(
                    deleted_at=utc_now(),
                    updated_at=utc_now(),
                    revision=ThoughtNote.revision + 1,
                )
            )
        siblings = (
            await self.session.scalars(
                select(ThoughtNote)
                .where(
                    ThoughtNote.knowledge_base_id == row.knowledge_base_id,
                    ThoughtNote.workspace_id == self.workspace_id,
                    ThoughtNote.parent_id == parent_id,
                    ThoughtNote.is_home.is_(False),
                    ThoughtNote.deleted_at.is_(None),
                )
                .order_by(ThoughtNote.position, ThoughtNote.id)
            )
        ).all()
        for position, sibling in enumerate(siblings):
            sibling.position = position
        await self.session.commit()
        return note_out(await self.get(note_id))
