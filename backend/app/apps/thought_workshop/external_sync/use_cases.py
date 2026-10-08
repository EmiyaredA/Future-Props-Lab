from __future__ import annotations

from datetime import timedelta

import httpx
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError

from app.apps.thought_workshop.content_exports import resolve_assets
from app.apps.thought_workshop.models import ThoughtKnowledgeBase
from app.apps.thought_workshop.notes import Notes
from app.integrations.external.blocks import feishu_tree
from app.integrations.external.catalog import ExternalConnections
from app.integrations.external.contracts import ExternalError, document_target
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import iso_utc, utc_now

from .content import project_content
from .models import ArticleSyncAsset, ArticleSyncBinding, ArticleSyncStep, ArticleSyncTask
from .schemas import (
    ArticleBindingOut,
    ArticleSyncPreview,
    ArticleSyncReconcileOut,
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


class ArticleSync:
    def __init__(self, session, workspace_id, principal, transport=None):
        self.session, self.workspace_id, self.principal, self.transport = (
            session,
            workspace_id,
            principal,
            transport,
        )
        if not principal.allows("configuration.manage"):
            raise ExternalError("需要工作区管理员或拥有者权限", 403, "permission_denied")

    async def note(self, id):
        row = await Notes(self.session, self.workspace_id).get(id)
        library = await self.session.get(ThoughtKnowledgeBase, row.knowledge_base_id)
        if row.deleted_at or not library or library.deleted_at:
            raise ExternalError("文章已进入回收站", 409, "note_deleted")
        return row

    async def binding(self, note_id):
        return await self.session.scalar(
            select(ArticleSyncBinding).where(
                ArticleSyncBinding.workspace_id == self.workspace_id,
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
                    ArticleSyncTask.workspace_id == self.workspace_id,
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

    async def bind(self, note_id, body):
        note = await self.note(note_id)
        current = await self.binding(note_id)
        if current and current.revision != body.expected_revision:
            raise RevisionConflictError(
                body.expected_revision,
                current.revision,
                binding_out(current).model_dump(mode="json"),
            )
        if not current and body.expected_revision != 0:
            raise ExternalError("绑定已变化，请刷新", 409)
        if current:
            await self.idle(current.target_key)
        note_revision = note.revision
        current_id = current.id if current else None
        document_id, url = document_target(body.url)
        target_key = "feishu:" + document_id
        await self.idle(target_key)
        connection_revision = (
            await ExternalConnections(self.session, self.workspace_id).get(body.connection_id)
        ).revision
        remote = await ExternalConnections(self.session, self.workspace_id, self.transport).target(
            body.connection_id, url
        )
        if not remote.can_write:
            raise ExternalError("应用没有目标文档的编辑权限", 403, "target_readonly")
        # Recheck the note after network I/O; then acquire a write via its existing revision.
        note = await self.note(note_id)
        if note.revision != note_revision:
            raise ExternalError("文章已变化，请重新绑定", 409)
        await ExternalConnections(self.session, self.workspace_id).require_enabled(
            body.connection_id, expected_revision=connection_revision
        )
        await self.idle(target_key)
        current = await self.binding(note_id)
        if current:
            await self.idle(current.target_key)
        values = dict(
            connection_id=body.connection_id,
            document_id=document_id,
            target_key=target_key,
            url=url,
            title=remote.title,
            last_fingerprint="",
            last_note_revision=None,
            last_synced_at=None,
        )
        try:
            if current_id:
                result = await self.session.execute(
                    update(ArticleSyncBinding)
                    .where(
                        ArticleSyncBinding.id == current_id,
                        ArticleSyncBinding.revision == body.expected_revision,
                    )
                    .values(**values, revision=ArticleSyncBinding.revision + 1)
                )
                if result.rowcount != 1:
                    raise ExternalError("绑定已变化，请刷新", 409)
            else:
                self.session.add(
                    ArticleSyncBinding(workspace_id=self.workspace_id, note_id=note_id, **values)
                )
            await self.session.commit()
        except IntegrityError:
            await self.session.rollback()
            raise ExternalError(
                "目标文档已有有效绑定，请使用另一份文档", 409, "target_bound"
            ) from None
        return binding_out(await self.binding(note_id))

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

    async def preview(self, note_id, body):
        note = await self.note(note_id)
        if note.revision != body.expected_revision:
            raise ExternalError("文章已变化，请保存后重新预览", 409, "note_changed")
        binding = await self.binding(note_id)
        if not binding or binding.revision != body.binding_revision:
            raise ExternalError("绑定已变化，请重新预览", 409)
        await self.idle(binding.target_key)
        content = (
            project_content(note.title, note.document)
            if note.kind == "note"
            else {
                "nodes": [],
                "text": note.title,
                "asset_ids": [],
                "warnings": [],
                "blockers": ["暂不支持多维表文档"],
            }
        )
        if not content["blockers"]:
            try:
                feishu_tree(content["nodes"])
            except ExternalError as exc:
                content["blockers"].append(str(exc))
        assets = await resolve_assets(self.session, self.workspace_id, set(content["asset_ids"]))
        for asset in assets.values():
            if asset.byte_size > 20 * 1024 * 1024 or asset.mime_type not in {
                "image/png",
                "image/jpeg",
                "image/gif",
                "image/webp",
            }:
                content["blockers"].append(
                    f"图片 {asset.original_filename} 格式不支持或超过 20 MiB"
                )
        connection = await ExternalConnections(self.session, self.workspace_id).get(
            binding.connection_id
        )
        fields = dict(
            workspace_id=self.workspace_id,
            note_id=note_id,
            binding_id=binding.id,
            binding_revision=binding.revision,
            connection_id=connection.id,
            connection_revision=connection.revision,
            target_key=binding.target_key,
            note_revision=note.revision,
            content=content,
        )
        # JSON does not encode principal frozensets or datetimes.
        fields["actor"] = {
            "user_id": self.principal.user_id,
            "auth_kind": self.principal.auth_kind,
            "api_key_id": self.principal.api_key_id,
        }
        document_id, previous = binding.document_id, binding.last_fingerprint
        client = await ExternalConnections(self.session, self.workspace_id, self.transport).client(
            fields["connection_id"], expected_revision=fields["connection_revision"]
        )
        try:
            remote = await client.read(document_id)
            if not await client.can_write(document_id):
                raise ExternalError("目标文档不可编辑", 403)
        except httpx.HTTPError:
            raise ExternalError("飞书连接失败，请重试", 502) from None
        task = None
        if not content["blockers"]:
            task = ArticleSyncTask(**fields, remote=remote.snapshot())
            self.session.add(task)
            await self.session.flush()
            self.session.add_all(
                ArticleSyncAsset(task_id=task.id, asset_id=id) for id in content["asset_ids"]
            )
            await self.session.commit()
        return ArticleSyncPreview(
            preview_id=task.id if task else None,
            note_revision=fields["note_revision"],
            local_text=content["text"],
            remote_text=remote.text,
            target_title=remote.title,
            warnings=content["warnings"],
            blockers=content["blockers"],
            remote_changed=bool(previous and previous != remote.fingerprint),
            first_sync=not previous,
        )

    async def get_task(self, note_id, task_id):
        row = await self.session.scalar(
            select(ArticleSyncTask).where(
                ArticleSyncTask.id == task_id,
                ArticleSyncTask.workspace_id == self.workspace_id,
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

    async def submit(self, note_id, body):
        operation_id = str(body.operation_id)
        existing = await self.session.scalar(
            select(ArticleSyncTask).where(
                ArticleSyncTask.workspace_id == self.workspace_id,
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
        client = await ExternalConnections(self.session, self.workspace_id, self.transport).client(
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
        await ExternalConnections(self.session, self.workspace_id).require_enabled(
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
                    ArticleSyncTask.workspace_id == self.workspace_id,
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
        client = await ExternalConnections(self.session, self.workspace_id, self.transport).client(
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
            await ExternalConnections(self.session, self.workspace_id).require_enabled(
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
