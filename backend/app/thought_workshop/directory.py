"""Project-scoped tree operations under a single revision reservation."""

from sqlalchemy import delete, select, update

from app.models.defaults import utc_now
from app.models.thought_workshop import ThoughtFolder, ThoughtNote
from app.schemas.thought_knowledge import (
    KnowledgeNoteCreate,
    ThoughtDirectoryOut,
    ThoughtFolderIn,
    ThoughtFolderOut,
    ThoughtMoveIn,
)
from app.schemas.thought_workshop import ThoughtNoteCreate, ThoughtNoteIn, ThoughtNoteSummary
from app.thought_workshop.errors import ThoughtError
from app.thought_workshop.knowledge import KnowledgeBases
from app.thought_workshop.notes import Notes, note_out


class Directory(KnowledgeBases):
    async def folder(self, project_id: str, folder_id: str | None) -> ThoughtFolder | None:
        if folder_id is None:
            return None
        row = await self.session.scalar(
            select(ThoughtFolder).where(
                ThoughtFolder.id == folder_id,
                ThoughtFolder.knowledge_base_id == project_id,
            )
        )
        if row is None:
            raise ThoughtError("文件夹不存在", 404, "not_found")
        return row

    async def tree(self, project_id: str) -> ThoughtDirectoryOut:
        project = await self.get(project_id)
        folders = (
            await self.session.scalars(
                select(ThoughtFolder)
                .where(
                    ThoughtFolder.knowledge_base_id == project_id,
                )
                .order_by(ThoughtFolder.position, ThoughtFolder.id)
            )
        ).all()
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
            folders=[ThoughtFolderOut.model_validate(row) for row in folders],
            documents=[ThoughtNoteSummary(**note_out(row).model_dump()) for row in notes],
        )

    async def siblings(self, project_id: str, parent_id: str | None):
        folders = (
            await self.session.scalars(
                select(ThoughtFolder).where(
                    ThoughtFolder.knowledge_base_id == project_id,
                    ThoughtFolder.parent_id == parent_id,
                )
            )
        ).all()
        notes = (
            await self.session.scalars(
                select(ThoughtNote).where(
                    ThoughtNote.knowledge_base_id == project_id,
                    ThoughtNote.folder_id == parent_id,
                    ThoughtNote.is_home.is_(False),
                    ThoughtNote.deleted_at.is_(None),
                )
            )
        ).all()
        return sorted([*folders, *notes], key=lambda row: (row.position, row.id))

    async def create_folder(self, project_id: str, body: ThoughtFolderIn) -> ThoughtDirectoryOut:
        await self.reserve(project_id, body.expected_revision)
        await self.folder(project_id, body.parent_id)
        siblings = await self.siblings(project_id, body.parent_id)
        self.session.add(
            ThoughtFolder(
                knowledge_base_id=project_id,
                title=body.title,
                parent_id=body.parent_id,
                position=max((r.position for r in siblings), default=-1) + 1,
            )
        )
        await self.session.commit()
        return await self.tree(project_id)

    async def rename_folder(
        self, project_id: str, folder_id: str, body: ThoughtFolderIn
    ) -> ThoughtDirectoryOut:
        await self.reserve(project_id, body.expected_revision)
        row = await self.folder(project_id, folder_id)
        row.title, row.updated_at = body.title, utc_now()
        await self.session.commit()
        return await self.tree(project_id)

    async def create_note(self, project_id: str, body: KnowledgeNoteCreate):
        await self.reserve(project_id, body.expected_revision)
        await self.folder(project_id, body.folder_id)
        siblings = await self.siblings(project_id, body.folder_id)
        row = await Notes(self.session, self.workspace_id).create(
            ThoughtNoteIn(knowledge_base_id=project_id, folder_id=body.folder_id, title=body.title),
            commit=False,
        )
        row.position = max((r.position for r in siblings), default=-1) + 1
        await self.session.commit()
        return note_out(row)

    async def create_content(self, body: ThoughtNoteCreate):
        await self.reserve(body.knowledge_base_id, body.expected_knowledge_revision)
        row = await Notes(self.session, self.workspace_id).create(
            ThoughtNoteIn(**body.model_dump(exclude={"expected_knowledge_revision"})), commit=False
        )
        siblings = await self.siblings(body.knowledge_base_id, body.folder_id)
        row.position = max((r.position for r in siblings), default=-1) + 1
        await self.session.commit()
        return note_out(row)

    async def move(self, project_id: str, body: ThoughtMoveIn) -> ThoughtDirectoryOut:
        await self.reserve(project_id, body.expected_revision)
        await self.folder(project_id, body.parent_id)
        if body.kind == "folder":
            row = await self.folder(project_id, body.item_id)
            parent_id = body.parent_id
            visited = {row.id}
            while parent_id:
                if parent_id in visited:
                    raise ThoughtError("不能将文件夹移入自身或子文件夹")
                visited.add(parent_id)
                parent_id = (await self.folder(project_id, parent_id)).parent_id
            row.parent_id = body.parent_id
        else:
            row = await Notes(self.session, self.workspace_id).get(body.item_id)
            if row.knowledge_base_id != project_id or row.is_home or row.deleted_at:
                raise ThoughtError("文档不能移动到该位置")
            row.folder_id = body.parent_id
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

    async def delete_folder(
        self, project_id: str, folder_id: str, expected: int
    ) -> ThoughtDirectoryOut:
        await self.reserve(project_id, expected)
        row = await self.folder(project_id, folder_id)
        parent_id = row.parent_id
        await self.session.execute(
            update(ThoughtFolder)
            .where(
                ThoughtFolder.knowledge_base_id == project_id,
                ThoughtFolder.parent_id == folder_id,
            )
            .values(parent_id=parent_id, updated_at=utc_now())
        )
        await self.session.execute(
            update(ThoughtNote)
            .where(
                ThoughtNote.knowledge_base_id == project_id,
                ThoughtNote.folder_id == folder_id,
            )
            .values(folder_id=parent_id, revision=ThoughtNote.revision + 1, updated_at=utc_now())
        )
        await self.session.execute(delete(ThoughtFolder).where(ThoughtFolder.id == folder_id))
        for i, child in enumerate(await self.siblings(project_id, parent_id)):
            child.position = i
        await self.session.commit()
        return await self.tree(project_id)
