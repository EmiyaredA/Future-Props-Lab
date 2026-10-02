from sqlalchemy import delete, select, update

from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.history import History
from app.apps.thought_workshop.models import ThoughtNote
from app.apps.thought_workshop.notes import Notes
from app.runtime.revisions import RevisionConflictError

from .models import ThoughtCheckpoint
from .schemas import CheckpointOut


class Checkpoints:
    def __init__(self, session, workspace_id):
        self.session, self.workspace_id = session, workspace_id

    async def list(self, note_id):
        await Notes(self.session, self.workspace_id).get(note_id)
        return [
            CheckpointOut.model_validate(row)
            for row in await self.session.scalars(
                select(ThoughtCheckpoint)
                .where(ThoughtCheckpoint.note_id == note_id)
                .order_by(ThoughtCheckpoint.created_at.desc(), ThoughtCheckpoint.id)
            )
        ]

    async def get(self, note_id, id):
        await Notes(self.session, self.workspace_id).get(note_id)
        row = await self.session.scalar(
            select(ThoughtCheckpoint)
            .where(ThoughtCheckpoint.id == id, ThoughtCheckpoint.note_id == note_id)
            .execution_options(populate_existing=True)
        )
        if row is None:
            raise ThoughtError("快照标记不存在", 404, "not_found")
        return row

    async def create(self, note_id, body):
        notes = Notes(self.session, self.workspace_id)
        await notes.get(note_id)
        await History(self.session).get(note_id, body.history_id)
        guarded = await self.session.execute(
            update(ThoughtNote)
            .where(
                ThoughtNote.id == note_id,
                ThoughtNote.workspace_id == self.workspace_id,
                ThoughtNote.deleted_at.is_(None),
                ThoughtNote.revision == body.expected_note_revision,
            )
            .values(revision=ThoughtNote.revision)
        )
        if guarded.rowcount != 1:
            await notes.conflict(note_id, body.expected_note_revision)
        row = ThoughtCheckpoint(note_id=note_id, history_id=body.history_id, name=body.name)
        self.session.add(row)
        await self.session.commit()
        return CheckpointOut.model_validate(row)

    async def change(self, note_id, id, expected, name=None):
        await self.get(note_id, id)
        where = (
            ThoughtCheckpoint.id == id,
            ThoughtCheckpoint.note_id == note_id,
            ThoughtCheckpoint.revision == expected,
        )
        statement = (
            delete(ThoughtCheckpoint).where(*where)
            if name is None
            else update(ThoughtCheckpoint).where(*where).values(name=name, revision=expected + 1)
        )
        result = await self.session.execute(statement)
        if result.rowcount != 1:
            await self.session.rollback()
            current = CheckpointOut.model_validate(await self.get(note_id, id))
            raise RevisionConflictError(expected, current.revision, current.model_dump(mode="json"))
        await self.session.commit()
        return None if name is None else CheckpointOut.model_validate(await self.get(note_id, id))
