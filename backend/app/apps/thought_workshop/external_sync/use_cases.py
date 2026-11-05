from __future__ import annotations

from datetime import timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError

from app.integrations.external.catalog import ExternalConnections
from app.integrations.external.contracts import ExternalError
from app.runtime.time import utc_now

from .binding import bind_note
from .models import ArticleSyncAsset, ArticleSyncStep, ArticleSyncTask
from .preview import preview_note
from .records import ArticleSyncRecords, task_out
from .schemas import (
    ArticleSyncReconcileOut,
)


class ArticleSync(ArticleSyncRecords):
    def __init__(self, session, owner_user_id, principal, transport=None):
        super().__init__(session, owner_user_id, principal)
        self.transport = transport

    async def bind(self, note_id, body):
        return await bind_note(
            self,
            ExternalConnections(self.session, self.owner_user_id, self.transport),
            note_id,
            body,
        )

    async def preview(self, note_id, body):
        async def read_target(connection_id, document_id):
            connections = ExternalConnections(self.session, self.owner_user_id, self.transport)
            revision = (await connections.get(connection_id)).revision
            client = await connections.client(connection_id, expected_revision=revision)
            await self.session.rollback()
            remote = await client.read(document_id)
            if not await client.can_write(document_id):
                raise ExternalError("目标文档不可编辑", 403)
            return revision, remote

        return await preview_note(self, read_target, note_id, body)

    async def submit(self, note_id, body):
        operation_id = str(body.operation_id)
        existing = await self.session.scalar(
            select(ArticleSyncTask).where(
                ArticleSyncTask.owner_user_id == self.owner_user_id,
                ArticleSyncTask.operation_id == operation_id,
            )
        )
        if existing:
            if existing.note_id != note_id or existing.id != body.preview_id:
                raise ExternalError("操作标识已用于其他同步", 409)
            return task_out(existing)
        task = await self.get_task(note_id, body.preview_id)
        if task.status != "preview" or not body.confirm_replace:
            raise ExternalError("请重新预览并明确确认替换目标正文", 409)
        if task.created_at < utc_now() - timedelta(hours=1):
            raise ExternalError("预览已过期，请重新预览", 409, "preview_expired")
        note = await self.note(note_id)
        binding = await self.binding(note_id)
        if (
            note.revision != task.note_revision
            or not binding
            or binding.id != task.binding_id
            or binding.revision != task.binding_revision
        ):
            raise ExternalError("文章或绑定已变化，请重新预览", 409)
        await self.idle(task.target_key)
        connection_id, connection_revision = task.connection_id, task.connection_revision
        document_id, expected = task.remote["document_id"], task.remote["fingerprint"]
        remote_revision = task.remote["revision"]
        task_id = task.id
        client = await ExternalConnections(self.session, self.owner_user_id, self.transport).client(
            connection_id, expected_revision=connection_revision
        )
        remote = await client.read(document_id)
        if remote.fingerprint != expected or remote.revision != remote_revision:
            raise ExternalError("飞书内容已变化，请重新预览再确认", 409, "remote_changed")
        note = await self.note(note_id)
        task = await self.get_task(note_id, task_id)
        binding = await self.binding(note_id)
        if (
            not binding
            or binding.id != task.binding_id
            or binding.revision != task.binding_revision
            or note.revision != task.note_revision
        ):
            raise ExternalError("文章或绑定已变化，请重新预览", 409)
        await ExternalConnections(self.session, self.owner_user_id).require_enabled(
            connection_id, expected_revision=connection_revision
        )
        try:
            result = await self.session.execute(
                update(ArticleSyncTask)
                .where(ArticleSyncTask.id == task_id, ArticleSyncTask.status == "preview")
                .values(
                    status="queued",
                    operation_id=operation_id,
                    updated_at=utc_now(),
                    actor={
                        "user_id": self.principal.user_id,
                        "auth_kind": self.principal.auth_kind,
                        "api_key_id": self.principal.api_key_id,
                    },
                )
            )
            if result.rowcount != 1:
                raise ExternalError("预览已提交，请刷新任务", 409)
            await self.session.commit()
        except IntegrityError:
            await self.session.rollback()
            existing = await self.session.scalar(
                select(ArticleSyncTask).where(
                    ArticleSyncTask.owner_user_id == self.owner_user_id,
                    ArticleSyncTask.operation_id == operation_id,
                )
            )
            if existing and existing.id == task_id:
                return task_out(existing)
            raise ExternalError("目标文档存在执行中的任务", 409, "target_busy") from None
        return task_out(await self.get_task(note_id, task_id))

    async def reconcile(self, note_id, task_id, body):
        task = await self.get_task(note_id, task_id)
        if task.status != "needs_review":
            raise ExternalError("任务不处于待核对状态", 409)
        if body.acknowledge_partial:
            result = await self.session.execute(
                update(ArticleSyncTask)
                .where(ArticleSyncTask.id == task_id, ArticleSyncTask.status == "needs_review")
                .values(
                    status="failed",
                    message="用户已核对并结束任务；远端可能保留部分内容，下一次同步需重新预览",
                    updated_at=utc_now(),
                )
            )
            if result.rowcount != 1:
                raise ExternalError("任务状态已变化，请刷新", 409)
            await self.session.execute(
                delete(ArticleSyncAsset).where(ArticleSyncAsset.task_id == task_id)
            )
            await self.session.commit()
            return ArticleSyncReconcileOut(
                task=task_out(await self.get_task(note_id, task_id)),
                remote_text="",
                can_resume=False,
            )
        expected = dict(task.checkpoint.get("remote", task.remote))
        checkpoint = dict(task.checkpoint)
        connection_id, connection_revision = task.connection_id, task.connection_revision
        pending = await self.session.scalar(
            select(ArticleSyncStep.id).where(
                ArticleSyncStep.task_id == task_id, ArticleSyncStep.status == "pending"
            )
        )
        client = await ExternalConnections(self.session, self.owner_user_id, self.transport).client(
            connection_id, expected_revision=connection_revision
        )
        remote = await client.read(expected["document_id"])
        task = await self.get_task(note_id, task_id)
        if task.status != "needs_review":
            raise ExternalError("任务状态已变化，请刷新", 409)
        safe = (
            not pending
            and remote.fingerprint == expected["fingerprint"]
            and remote.revision == expected["revision"]
        )
        if safe:
            await self.note(note_id)
            await ExternalConnections(self.session, self.owner_user_id).require_enabled(
                connection_id, expected_revision=connection_revision
            )
            binding = await self.binding(note_id)
            if (
                not binding
                or binding.id != task.binding_id
                or binding.revision != task.binding_revision
            ):
                raise ExternalError("绑定已变化，无法继续", 409)
            task.status, task.message = "queued", "远端与已确认步骤一致，将继续同步"
            task.actor = {
                "user_id": self.principal.user_id,
                "auth_kind": self.principal.auth_kind,
                "api_key_id": self.principal.api_key_id,
            }
        else:
            task.message = "有未确认步骤或远端已变化，请打开飞书核对，明确结束任务后重新预览"
        task.checkpoint, task.updated_at = checkpoint, utc_now()
        await self.session.commit()
        return ArticleSyncReconcileOut(
            task=task_out(task), remote_text=remote.text, can_resume=safe
        )
