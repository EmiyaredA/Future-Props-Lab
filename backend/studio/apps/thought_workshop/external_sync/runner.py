from __future__ import annotations

from datetime import timedelta

import httpx
from sqlalchemy import delete, select, update

from app.integrations.external.blocks import feishu_tree
from app.integrations.external.catalog import ExternalConnections
from app.integrations.external.contracts import ExternalError, ImageSource
from app.integrations.external.feishu_verification import (
    assert_snapshot,
    verify_append,
    verify_delete,
    verify_image,
)
from app.runtime.db import SessionLocal
from app.runtime.ownership import bind_owner
from studio.apps.thought_workshop.content_exports import resolve_assets
from studio.apps.thought_workshop.external_sync.models import (
    ArticleSyncAsset,
    ArticleSyncBinding,
    ArticleSyncStep,
    ArticleSyncTask,
)
from studio.apps.thought_workshop.storage.models import ThoughtKnowledgeBase, ThoughtNote
from studio.apps.thought_workshop.website.asset_metadata import read_bytes
from studio.runtime.tasks.polling import PollingTaskRunner
from studio.runtime.time import utc_now


class ArticleSyncRunner(PollingTaskRunner):
    runner_name = "article-external-sync"

    def __init__(self, actor_allowed, transport=None, sessions=SessionLocal):
        super().__init__()
        self.actor_allowed, self.transport, self.sessions = actor_allowed, transport, sessions

    async def recover(self):
        async with self.sessions() as session:
            await session.execute(
                update(ArticleSyncTask)
                .where(ArticleSyncTask.status == "running")
                .values(
                    status="needs_review",
                    message="应用在同步期间退出；请核对远端结果，不会自动重放写入",
                    updated_at=utc_now(),
                )
            )
            await session.commit()

    async def process_once(self):
        async with self.sessions() as session:
            # Stale previews hold no reusable authorization; release their asset references.
            await session.execute(
                delete(ArticleSyncTask).where(
                    ArticleSyncTask.status == "preview",
                    ArticleSyncTask.created_at < utc_now() - timedelta(hours=1),
                )
            )
            ids = list(
                await session.scalars(
                    select(ArticleSyncTask.id)
                    .where(ArticleSyncTask.status == "queued")
                    .order_by(ArticleSyncTask.created_at)
                    .limit(4)
                )
            )
            await session.commit()
        await self.run_concurrently(ids, self.execute)

    async def context(self, session, task_id):
        task = await session.get(ArticleSyncTask, task_id)
        if not task or task.status != "running":
            raise ExternalError("同步任务已停止", 409)
        bind_owner(session, task.owner_user_id)
        note = await session.scalar(
            select(ThoughtNote).where(
                ThoughtNote.id == task.note_id, ThoughtNote.owner_user_id == task.owner_user_id
            )
        )
        library = await session.get(ThoughtKnowledgeBase, note.knowledge_base_id) if note else None
        binding = await session.get(ArticleSyncBinding, task.binding_id)
        if (
            not note
            or note.deleted_at
            or not library
            or library.deleted_at
            or not binding
            or binding.revision != task.binding_revision
        ):
            raise ExternalError("文章、知识库或绑定已变化，已停止同步", 409)
        if not await self.actor_allowed(session, task.owner_user_id, task.actor):
            raise ExternalError("执行者权限已变化，已停止同步", 403)
        await ExternalConnections(session, task.owner_user_id).get(task.connection_id)
        return task

    async def before_step(self, task_id, client):
        async with self.sessions() as session:
            task = await self.context(session, task_id)
            expected = dict(task.checkpoint.get("remote", task.remote))
            await ExternalConnections(session, task.owner_user_id).client(
                task.connection_id, expected_revision=task.connection_revision
            )
        remote = await client.read(expected["document_id"])
        assert_snapshot(remote, expected)
        return expected

    async def begin_step(self, task_id, kind):
        async with self.sessions() as session:
            task = await self.context(session, task_id)
            await ExternalConnections(session, task.owner_user_id).require_enabled(
                task.connection_id, expected_revision=task.connection_revision
            )
            step = ArticleSyncStep(task_id=task_id, kind=kind)
            session.add(step)
            await session.commit()
            return step.id

    async def finish_step(self, task_id, step_id, response, checkpoint):
        async with self.sessions() as session:
            task = await session.get(ArticleSyncTask, task_id)
            step = await session.get(ArticleSyncStep, step_id)
            step.status, step.result = "confirmed", response
            task.checkpoint, task.updated_at = checkpoint, utc_now()
            await session.commit()

    async def result(self, task_id, status, message):
        async with self.sessions() as session:
            task = await session.get(ArticleSyncTask, task_id)
            task.status, task.message, task.updated_at = status, message, utc_now()
            if status in {"succeeded", "failed", "conflict"}:
                await session.execute(
                    delete(ArticleSyncAsset).where(ArticleSyncAsset.task_id == task_id)
                )
            if status == "succeeded":
                binding = await session.get(ArticleSyncBinding, task.binding_id)
                if binding:
                    binding.last_fingerprint = task.checkpoint["remote"]["fingerprint"]
                    binding.title = task.checkpoint["remote"]["title"]
                    binding.last_note_revision, binding.last_synced_at = (
                        task.note_revision,
                        utc_now(),
                    )
            await session.commit()

    async def execute(self, task_id):
        async with self.sessions() as session:
            claimed = await session.execute(
                update(ArticleSyncTask)
                .where(ArticleSyncTask.id == task_id, ArticleSyncTask.status == "queued")
                .values(status="running", updated_at=utc_now())
            )
            await session.commit()
            if claimed.rowcount != 1:
                return
        wrote = False
        try:
            async with self.sessions() as session:
                task = await self.context(session, task_id)
                checkpoint, content, remote = (
                    dict(task.checkpoint),
                    dict(task.content),
                    dict(task.remote),
                )
                client = await ExternalConnections(
                    session, task.owner_user_id, self.transport
                ).client(task.connection_id, expected_revision=task.connection_revision)
            document_id = remote["document_id"]
            if not await client.can_write(document_id):
                raise ExternalError("飞书目标文档不可编辑", 403)
            if not checkpoint.get("appended"):
                before = await self.before_step(task_id, client)
                tree = feishu_tree(content["nodes"])
                step = await self.begin_step(task_id, "append")
                wrote = True
                response = await client.append(document_id, tree, before["revision"], step)
                after = await client.read(document_id)
                if response.get("document_revision_id") != after.revision:
                    raise ExternalError("写入后远端版本发生变化", 409)
                image_slots = verify_append(before, after, response, tree)
                checkpoint.update(
                    appended=True,
                    images=image_slots,
                    remote=after.snapshot(),
                    tokens={},
                    replaced=[],
                )
                await self.finish_step(task_id, step, response, checkpoint)
            for block_id, asset_id in checkpoint["images"].items():
                if block_id in checkpoint["replaced"]:
                    continue
                if block_id not in checkpoint["tokens"]:
                    before = await self.before_step(task_id, client)
                    async with self.sessions() as session:
                        task = await self.context(session, task_id)
                        assets = await resolve_assets(session, task.owner_user_id, {asset_id})
                        asset = assets[asset_id]
                        filename, mime, owner = (
                            asset.original_filename,
                            asset.mime_type,
                            task.owner_user_id,
                        )
                        await session.rollback()
                        data = await read_bytes(session, owner, asset)
                    step = await self.begin_step(task_id, "upload_image")
                    wrote = True
                    token = await client.upload_image(
                        document_id, block_id, ImageSource(filename, mime, data)
                    )
                    after = await client.read(document_id)
                    assert_snapshot(after, before)
                    checkpoint["tokens"][block_id] = token
                    await self.finish_step(task_id, step, {"file_token": token}, checkpoint)
                before = await self.before_step(task_id, client)
                step = await self.begin_step(task_id, "replace_image")
                wrote = True
                token = checkpoint["tokens"][block_id]
                response = await client.replace_image(
                    document_id, block_id, token, before["revision"], step
                )
                after = await client.read(document_id)
                if response.get("document_revision_id") != after.revision:
                    raise ExternalError("图片写入后远端版本发生变化", 409)
                verify_image(before, after, block_id, token)
                checkpoint["remote"] = after.snapshot()
                checkpoint["replaced"] = checkpoint["replaced"] + [block_id]
                await self.finish_step(task_id, step, response, checkpoint)
            if not checkpoint.get("deleted"):
                before = await self.before_step(task_id, client)
                old_ids = remote["root_ids"]
                if old_ids:
                    step = await self.begin_step(task_id, "delete_old")
                    wrote = True
                    response = await client.delete_prefix(
                        document_id, len(old_ids), before["revision"], step
                    )
                    after = await client.read(document_id)
                    if response.get("document_revision_id") != after.revision:
                        raise ExternalError("移除旧正文后远端版本发生变化", 409)
                    verify_delete(before, after, old_ids)
                    checkpoint.update(deleted=True, remote=after.snapshot())
                    await self.finish_step(task_id, step, response, checkpoint)
                else:
                    checkpoint["deleted"] = True
            await self.before_step(task_id, client)
            await self.result(task_id, "succeeded", "文章已同步到飞书")
        except (ExternalError, httpx.HTTPError, OSError) as exc:
            async with self.sessions() as session:
                task = await session.get(ArticleSyncTask, task_id)
                partial = wrote or bool(task.checkpoint.get("appended"))
            status = (
                "needs_review"
                if partial
                else "conflict"
                if isinstance(exc, ExternalError) and exc.code == "remote_changed"
                else "failed"
            )
            await self.result(
                task_id,
                status,
                str(exc)
                if isinstance(exc, ExternalError)
                else "网络或素材读取失败；请核对远端结果后重试",
            )
        except Exception:
            # Unknown adapter responses are ambiguous, never permit another blind overwrite.
            await self.result(task_id, "needs_review", "同步结果需要核对；不会自动重放外部写入")
