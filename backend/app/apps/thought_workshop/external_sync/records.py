from __future__ import annotations

from sqlalchemy import delete, select

from app.apps.thought_workshop.models import ThoughtKnowledgeBase
from app.apps.thought_workshop.notes import Notes
from app.integrations.external.contracts import ExternalError
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import iso_utc

from .models import ArticleSyncBinding, ArticleSyncStep, ArticleSyncTask
from .schemas import (
    ArticleBindingOut,
    ArticleSyncState,
    ArticleSyncTaskOut,
)

UNRESOLVED = {"queued", "running", "needs_review"}


def binding_out(row):
    return ArticleBindingOut(
        id=row.id,
        connection_id=row.connection_id,
        url=row.url,
        title=row.title,
        revision=row.revision,
        last_note_revision=row.last_note_revision,
        last_synced_at=iso_utc(row.last_synced_at) if row.last_synced_at else None,
    )


def task_out(row, steps=()):
    return ArticleSyncTaskOut(
        id=row.id,
        status=row.status,
        note_revision=row.note_revision,
        message=row.message,
        created_at=iso_utc(row.created_at),
        updated_at=iso_utc(row.updated_at),
        steps=[
            {"kind": s.kind, "status": s.status, "created_at": iso_utc(s.created_at)} for s in steps
        ],
    )


class ArticleSyncRecords:
    def __init__(self, session, owner_user_id, principal):
        self.session, self.owner_user_id, self.principal = (
            session,
            owner_user_id,
            principal,
        )
        if not principal.allows("configuration.manage"):
            raise ExternalError("需要账号管理员或拥有者权限", 403, "permission_denied")

    async def note(self, id):
        row = await Notes(self.session, self.owner_user_id).get(id)
        library = await self.session.get(ThoughtKnowledgeBase, row.knowledge_base_id)
        if row.deleted_at or not library or library.deleted_at:
            raise ExternalError("文章已进入回收站", 409, "note_deleted")
        return row

    async def binding(self, note_id):
        return await self.session.scalar(
            select(ArticleSyncBinding).where(
                ArticleSyncBinding.owner_user_id == self.owner_user_id,
                ArticleSyncBinding.note_id == note_id,
            )
        )

    async def state(self, note_id):
        await self.note(note_id)
        row = await self.binding(note_id)
        tasks = list(
            await self.session.scalars(
                select(ArticleSyncTask)
                .where(
                    ArticleSyncTask.owner_user_id == self.owner_user_id,
                    ArticleSyncTask.note_id == note_id,
                    ArticleSyncTask.status != "preview",
                )
                .order_by(ArticleSyncTask.created_at.desc())
                .limit(15)
            )
        )
        return ArticleSyncState(
            binding=binding_out(row) if row else None, tasks=[task_out(t) for t in tasks]
        )

    async def idle(self, target_key):
        active = await self.session.scalar(
            select(ArticleSyncTask.id).where(
                ArticleSyncTask.target_key == target_key, ArticleSyncTask.status.in_(UNRESOLVED)
            )
        )
        if active:
            raise ExternalError("目标存在执行中或需要核对的同步任务，请先处理", 409, "target_busy")

    async def unbind(self, note_id, expected):
        await self.note(note_id)
        row = await self.binding(note_id)
        if not row:
            raise ExternalError("绑定不存在", 404)
        await self.idle(row.target_key)
        result = await self.session.execute(
            delete(ArticleSyncBinding).where(
                ArticleSyncBinding.id == row.id, ArticleSyncBinding.revision == expected
            )
        )
        if result.rowcount != 1:
            raise RevisionConflictError(
                expected, row.revision, binding_out(row).model_dump(mode="json")
            )
        await self.session.commit()

    async def get_task(self, note_id, task_id):
        row = await self.session.scalar(
            select(ArticleSyncTask).where(
                ArticleSyncTask.id == task_id,
                ArticleSyncTask.owner_user_id == self.owner_user_id,
                ArticleSyncTask.note_id == note_id,
            )
        )
        if not row:
            raise ExternalError("同步任务不存在", 404, "not_found")
        return row

    async def detail(self, note_id, task_id):
        task = await self.get_task(note_id, task_id)
        steps = list(
            await self.session.scalars(
                select(ArticleSyncStep)
                .where(ArticleSyncStep.task_id == task_id)
                .order_by(ArticleSyncStep.created_at)
            )
        )
        return task_out(task, steps)
