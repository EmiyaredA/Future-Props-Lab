"""Execute authorized sync steps and retain unknown outcomes for reconciliation."""

import base64
from datetime import timedelta
from uuid import uuid4

from sqlalchemy import delete, select, update

from studio.apps.integrations.clients.document_blocks import feishu_tree
from studio.apps.thought_workshop.external_sync.models import (
    ArticleSyncAsset,
    ArticleSyncBinding,
    ArticleSyncStep,
    ArticleSyncTask,
)
from studio.apps.thought_workshop.storage.models import ThoughtKnowledgeBase, ThoughtNote
from studio.apps.thought_workshop.synchronization.sync_transport import MAX_SNAPSHOT
from studio.contracts.integrations.external_documents import ExternalError
from studio.contracts.integrations.external_sync import (
    ExternalCheckpoint,
    ExternalDocumentSnapshot,
    ExternalRead,
    ExternalStep,
    ExternalTaskPayload,
)
from studio.runtime.tasks.polling import PollingTaskRunner
from studio.runtime.time import utc_now


async def current_task(session, task_id):
    task = await session.get(ArticleSyncTask, task_id)
    if task is None or task.status != "running":
        raise ExternalError("同步任务已停止", 409)
    note = await session.get(ThoughtNote, task.note_id)
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
    return task


class SyncRunner(PollingTaskRunner):
    runner_name = "thought-external-sync"

    def __init__(self, sessions, transport, artifacts):
        super().__init__()
        self.sessions, self.transport, self.artifacts = sessions, transport, artifacts

    async def jobs(self, status, *, limit=None):
        query = (
            select(ArticleSyncTask.owner_user_id, ArticleSyncTask.id)
            .where(ArticleSyncTask.status == status)
            .order_by(ArticleSyncTask.created_at)
            .limit(limit)
        )
        if status == "preview":
            query = query.where(ArticleSyncTask.created_at < utc_now() - timedelta(hours=1))
        async with self.sessions(info={"allow_system_reads": True}) as session:
            return list((await session.execute(query)).tuples())

    async def recover(self):
        for owner, task_id in await self.jobs("running"):
            await self.settle(owner, task_id, "needs_review", "同步期间退出；请核对远端结果")
        async with self.sessions(info={"allow_system_reads": True}) as session:
            checkpoints = list(
                await session.scalars(
                    select(ArticleSyncTask.checkpoint).where(
                        ArticleSyncTask.status.in_(("queued", "running", "needs_review"))
                    )
                )
            )
        await self.artifacts.sweep({item.get("staging") for item in checkpoints})

    async def process_once(self):
        for owner, task_id in await self.jobs("preview", limit=100):
            async with self.sessions(info={"owner_user_id": owner}) as session:
                await session.execute(
                    delete(ArticleSyncTask).where(
                        ArticleSyncTask.id == task_id,
                        ArticleSyncTask.status == "preview",
                    )
                )
                await session.commit()
        await self.run_concurrently(await self.jobs("queued", limit=4), self.execute)

    async def execute(self, job):
        owner, task_id = job
        async with self.sessions(info={"owner_user_id": owner}) as session:
            claimed = await session.execute(
                update(ArticleSyncTask)
                .where(
                    ArticleSyncTask.id == task_id,
                    ArticleSyncTask.status == "queued",
                )
                .values(status="running", updated_at=utc_now())
            )
            await session.commit()
            if claimed.rowcount != 1:
                return
        try:
            async with self.sessions(info={"owner_user_id": owner}) as session:
                task = await current_task(session, task_id)
                state = dict(task.checkpoint)
            if not state.get("intent_id"):
                await self.settle(owner, task_id, "needs_review", "旧同步任务需要核对后重新预览")
                return
            payload = ExternalTaskPayload.model_validate(state["payload"])
            checkpoint = ExternalCheckpoint.model_validate(
                state.get("progress", {"remote": payload.remote})
            )
            await self.verify_remote(state["intent_id"], checkpoint)
            while step := await self.next_step(payload, checkpoint, state.get("staging")):
                checkpoint = await self.perform(owner, task_id, state, step, checkpoint)
            await self.verify_remote(state["intent_id"], checkpoint)
            await self.settle(owner, task_id, "succeeded", "文章已同步到飞书")
        except (ExternalError, OSError, ValueError, KeyError) as exc:
            async with self.sessions(info={"owner_user_id": owner}) as session:
                attempted = await session.scalar(
                    select(ArticleSyncStep.id)
                    .where(
                        ArticleSyncStep.task_id == task_id,
                    )
                    .limit(1)
                )
            if attempted:
                status = "needs_review"
            elif isinstance(exc, ExternalError) and exc.code == "remote_changed":
                status = "conflict"
            else:
                status = "failed"
            message = str(exc) if isinstance(exc, ExternalError) else "同步快照无法读取"
            await self.settle(owner, task_id, status, message)
        except Exception:
            await self.settle(
                owner, task_id, "needs_review", "同步结果需要核对；不会自动重放外部写入"
            )

    async def verify_remote(self, intent_id, checkpoint):
        observed = await self.transport.call(
            intent_id,
            "read",
            ExternalRead(op="read", document_id=checkpoint.remote.document_id),
            ExternalDocumentSnapshot,
            maximum_bytes=MAX_SNAPSHOT,
        )
        if observed != checkpoint.remote:
            raise ExternalError("飞书内容已变化，请核对后重新预览", 409, "remote_changed")

    async def next_step(self, payload, checkpoint, staging):
        common = dict(task_payload=payload, step_id=uuid4())
        revision = checkpoint.remote.revision
        if not checkpoint.appended:
            return ExternalStep(
                **common,
                kind="append",
                tree=feishu_tree(payload.content["nodes"]),
                revision=revision,
            )
        for block_id, asset_id in checkpoint.images.items():
            if block_id in checkpoint.replaced:
                continue
            if block_id in checkpoint.tokens:
                return ExternalStep(
                    **common,
                    kind="replace_image",
                    block_id=block_id,
                    token=checkpoint.tokens[block_id],
                    revision=revision,
                )
            asset = next(asset for asset in payload.asset_manifest if asset.id == asset_id)
            data = await self.artifacts.read(staging, asset)
            return ExternalStep(
                **common,
                kind="upload_image",
                block_id=block_id,
                image_base64=base64.b64encode(data).decode("ascii"),
            )
        if not checkpoint.deleted and payload.remote["root_ids"]:
            return ExternalStep(
                **common,
                kind="delete_prefix",
                count=len(payload.remote["root_ids"]),
                revision=revision,
            )
        return None

    async def perform(self, owner, task_id, state, body, previous):
        step_id = str(body.step_id)
        kind = "delete_old" if body.kind == "delete_prefix" else body.kind
        async with self.sessions(info={"owner_user_id": owner}) as session:
            await current_task(session, task_id)
            session.add(
                ArticleSyncStep(
                    id=step_id,
                    task_id=task_id,
                    kind=kind,
                    result={"request_sha256": body.fingerprint()},
                )
            )
            await session.commit()
        result = await self.transport.step(state["intent_id"], body)
        progress = await self.transport.progress(state["intent_id"])
        checkpoint = progress.checkpoint
        if (
            progress.status not in {"active", "closed"}
            or checkpoint is None
            or checkpoint == previous
        ):
            raise ExternalError("同步步骤没有已确认的远端回执", 409, "uncertain_write")
        async with self.sessions(info={"owner_user_id": owner}) as session:
            task = await session.get(ArticleSyncTask, task_id)
            step = await session.get(ArticleSyncStep, step_id)
            if task is None or task.status != "running" or step.status != "pending":
                raise ExternalError("同步步骤已停止，请核对结果", 409, "uncertain_write")
            state = {
                **state,
                "progress": checkpoint.model_dump(),
                "remote": checkpoint.remote.model_dump(),
            }
            step.status, step.result = "confirmed", result
            task.checkpoint, task.updated_at = state, utc_now()
            await session.commit()
        return checkpoint

    async def settle(self, owner, task_id, status, message):
        staging = ""
        async with self.sessions(info={"owner_user_id": owner}) as session:
            task = await session.get(ArticleSyncTask, task_id)
            if task is None or task.status != "running":
                return
            task.status, task.message, task.updated_at = status, message, utc_now()
            if status in {"succeeded", "failed", "conflict"}:
                await session.execute(
                    delete(ArticleSyncAsset).where(ArticleSyncAsset.task_id == task_id)
                )
                staging = task.checkpoint.get("staging", "")
            if status == "succeeded":
                binding = await session.get(ArticleSyncBinding, task.binding_id)
                if binding is not None and binding.revision == task.binding_revision:
                    binding.last_fingerprint = task.checkpoint["remote"]["fingerprint"]
                    binding.title = task.checkpoint["remote"]["title"]
                    binding.last_note_revision, binding.last_synced_at = (
                        task.note_revision,
                        utc_now(),
                    )
            await session.commit()
        await self.artifacts.discard(staging)
