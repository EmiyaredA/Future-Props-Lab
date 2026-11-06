"""Project-scoped document tree operations under a single revision reservation."""

from sqlalchemy import select

from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.knowledge import KnowledgeBases
from studio.apps.thought_workshop.notes import Notes, note_out
from studio.apps.thought_workshop.schemas.knowledge import (
    KnowledgeNoteCreate,
    ThoughtDirectoryOut,
    ThoughtMoveIn,
)
from studio.apps.thought_workshop.schemas.workshop import (
    ThoughtNoteCreate,
    ThoughtNoteIn,
    ThoughtNoteSummary,
)
from studio.apps.thought_workshop.storage.models import ThoughtNote
from studio.runtime.time import utc_now


class Directory(KnowledgeBases):
    async def parent(self, project_id: str, parent_id: str | None) -> ThoughtNote | None:
        if parent_id is None:
            return None
        row = await self.session.scalar(
            select(ThoughtNote).where(
                ThoughtNote.id == parent_id,
                ThoughtNote.knowledge_base_id == project_id,
                ThoughtNote.owner_user_id == self.owner_user_id,
                ThoughtNote.deleted_at.is_(None),
                ThoughtNote.is_home.is_(False),
            )
        )
        if row is None:
            raise ThoughtError("父文档不存在", 404, "not_found")
        return row

    async def tree(self, project_id: str) -> ThoughtDirectoryOut:
        project = await self.get(project_id)
        notes = (
            await self.session.scalars(
                select(ThoughtNote)
                .where(
                    ThoughtNote.knowledge_base_id == project_id,
                    ThoughtNote.deleted_at.is_(None),
                    ThoughtNote.is_home.is_(False),
                )
                .order_by(ThoughtNote.position, ThoughtNote.id)
            )
        ).all()
        return ThoughtDirectoryOut(
            knowledge_base=await self.output(project),
            documents=[ThoughtNoteSummary(**note_out(row).model_dump()) for row in notes],
        )

    async def siblings(self, project_id: str, parent_id: str | None):
        return (
            await self.session.scalars(
                select(ThoughtNote)
                .where(
                    ThoughtNote.knowledge_base_id == project_id,
                    ThoughtNote.parent_id == parent_id,
                    ThoughtNote.is_home.is_(False),
                    ThoughtNote.deleted_at.is_(None),
                )
                .order_by(ThoughtNote.position, ThoughtNote.id)
            )
        ).all()

    async def create_note(
        self, project_id: str, body: KnowledgeNoteCreate, *, note_id=None, commit=True
    ):
        await self.reserve(project_id, body.expected_revision)
        await self.parent(project_id, body.parent_id)
        siblings = await self.siblings(project_id, body.parent_id)
        row = await Notes(
            self.session, self.owner_user_id, self.author_id, assets=self.assets
        ).create(
            ThoughtNoteIn(
                knowledge_base_id=project_id,
                parent_id=body.parent_id,
                title=body.title,
                kind=body.kind,
            ),
            commit=False,
            note_id=note_id,
        )
        row.position = max((r.position for r in siblings), default=-1) + 1
        if commit:
            await self.session.commit()
        return note_out(row)

    async def create_content(self, body: ThoughtNoteCreate, *, note_id=None, commit=True):
        candidate = ThoughtNoteIn(**body.model_dump(exclude={"expected_knowledge_revision"}))
        notes = Notes(self.session, self.owner_user_id, self.author_id, assets=self.assets)
        # Cross-service metadata is fetched before the project writer reservation.
        await notes.validate_refs(candidate)
        await self.reserve(body.knowledge_base_id, body.expected_knowledge_revision)
        row = await notes.create(candidate, commit=False, note_id=note_id)
        siblings = await self.siblings(body.knowledge_base_id, body.parent_id)
        row.position = max((r.position for r in siblings), default=-1) + 1
        if commit:
            await self.session.commit()
        return note_out(row)

    async def move(self, project_id: str, body: ThoughtMoveIn) -> ThoughtDirectoryOut:
        await self.reserve(project_id, body.expected_revision)
        await self.parent(project_id, body.parent_id)
        row = await Notes(self.session, self.owner_user_id).get(body.item_id)
        if row.knowledge_base_id != project_id or row.is_home or row.deleted_at:
            raise ThoughtError("文档不能移动到该位置")
        if body.parent_id == row.id:
            raise ThoughtError("不能将文档移入自身或子文档")
        parent_id = body.parent_id
        visited = {row.id}
        while parent_id:
            if parent_id in visited:
                raise ThoughtError("不能将文档移入自身或子文档")
            visited.add(parent_id)
            ancestor = await Notes(self.session, self.owner_user_id).get(parent_id)
            if ancestor.knowledge_base_id != project_id or ancestor.is_home or ancestor.deleted_at:
                raise ThoughtError("父文档不存在", 404, "not_found")
            parent_id = ancestor.parent_id
        row.parent_id = body.parent_id
        row.revision += 1
        row.updated_at = utc_now()
        siblings = [r for r in await self.siblings(project_id, body.parent_id) if r.id != row.id]
        index = len(siblings)
        if body.before_id is not None:
            index = next((i for i, r in enumerate(siblings) if r.id == body.before_id), -1)
            if index < 0:
                raise ThoughtError("排序目标不存在或不在同一目录")
        siblings.insert(index, row)
        for position, sibling in enumerate(siblings):
            sibling.position = position
        await self.session.commit()
        return await self.tree(project_id)

    async def reorder_siblings(self, project_id: str, parent_id: str | None) -> None:
        for i, child in enumerate(await self.siblings(project_id, parent_id)):
            child.position = i
