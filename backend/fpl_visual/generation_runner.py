"""Project provider status and finalize each result through Visual's Canvas transaction."""

from sqlalchemy import select, text, update

from app.apps.visual_workshop.generation_common import GenerationError
from app.apps.visual_workshop.generation_records import ACTIVE_TASK_STATUSES
from app.apps.visual_workshop.models import VisualGenerationTask
from app.runtime.polling_runner import PollingTaskRunner
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import utc_now
from fpl_runtime.capability_client import CapabilityUnavailable
from fpl_runtime.project_errors import ProjectResourceError

from .generation_batches import GenerationBatches
from .generation_decisions import GenerationDecisions
from .generation_dispatch_records import VisualGenerationDecision, VisualGenerationDispatch
from .generation_output import GenerationOutput
from .generation_peer import GenerationPeer

TERMINAL = {"failed", "cancelled"}


class GenerationRunner(PollingTaskRunner):
    runner_name = "visual-generation-projection"
    poll_interval_seconds = 1

    def __init__(self, state):
        super().__init__()
        self.state = state
        self.sessions = state.database.sessions
        self.decisions = GenerationDecisions(state)
        self.batches = GenerationBatches(state)
        self.peer = GenerationPeer(state)
        self.output = GenerationOutput(state, self.peer)

    async def recover(self):
        await self.decisions.recover()

    async def process_once(self):
        errors = []
        try:
            await self.decisions.process_once()
        except CapabilityUnavailable as exc:
            errors.append(exc)
        dispatch = VisualGenerationDispatch
        async with self.sessions(info={"allow_system_reads": True}) as session:
            tasks = list(
                await session.execute(
                    select(dispatch.owner_user_id, dispatch.task_id)
                    .join(VisualGenerationTask, VisualGenerationTask.id == dispatch.task_id)
                    .join(VisualGenerationDecision, VisualGenerationDecision.id == dispatch.plan_id)
                    .where(
                        VisualGenerationDecision.state == "active",
                        VisualGenerationTask.status.in_(ACTIVE_TASK_STATUSES),
                    )
                    .order_by(dispatch.checked_at, dispatch.task_id)
                    .limit(50)
                )
            )
        for owner, task_id in tasks:
            try:
                await self.run(owner, task_id)
            except CapabilityUnavailable as exc:
                errors.append(exc)
        await self.batches.process_once()
        await self.acknowledge_results()
        if errors:
            raise errors[0]

    async def run(self, owner, task_id):
        async with self.sessions(info={"owner_user_id": owner}) as db:
            dispatch = await db.get(VisualGenerationDispatch, task_id)
            task = await db.get(VisualGenerationTask, task_id)
            if dispatch is None or task is None or task.status not in ACTIVE_TASK_STATUSES:
                return
            decision = await db.get(VisualGenerationDecision, dispatch.plan_id)
            if decision is None or decision.state != "active":
                return
            dispatch.checked_at = utc_now()
            await db.commit()
            receipt = dispatch.pending_receipt_id
            if receipt:
                await self.finish(owner, task_id, receipt)
                return
            try:
                remote = await self.peer.status(decision, task_id)
            except GenerationError as exc:
                raise CapabilityUnavailable("模型任务回执暂不可用") from exc
            await self.apply_remote(db, task_id, remote)
            if remote.status != "completed":
                return
            try:
                if remote.result is None:
                    raise GenerationError(
                        "模型未返回可验证的结果", code="result_unavailable", status=409
                    )
                receipt = await self.output.publish(db, decision, task, dispatch, remote)
            except RevisionConflictError:
                return
            except (GenerationError, ProjectResourceError) as exc:
                await db.rollback()
                if exc.status in (429, 503) or exc.code in {
                    "visual_upload_pending",
                    "segment_target_reserved",
                    "project_references_pending",
                }:
                    raise CapabilityUnavailable("生成结果等待素材结算") from exc
                await self.fail_publication(owner, task_id, str(exc))
                return
        await self.finish(owner, task_id, receipt)

    async def apply_remote(self, db, task_id, remote):
        await db.execute(text("BEGIN IMMEDIATE"))
        dispatch = await db.get(VisualGenerationDispatch, task_id, populate_existing=True)
        task = await db.get(VisualGenerationTask, task_id, populate_existing=True)
        if (
            dispatch is None
            or task is None
            or task.status not in ACTIVE_TASK_STATUSES
            or remote.revision <= dispatch.provider_revision
        ):
            await db.commit()
            return
        dispatch.provider_revision = remote.revision
        task.status = "processing" if remote.status == "completed" else remote.status
        task.provider_task_id = remote.provider_task_id
        task.progress = remote.progress
        task.execution_info = remote.execution_info
        task.error_message = remote.error_message
        task.result_url = f"models:{task_id}" if remote.can_retry_materialization else None
        task.revision += 1
        task.updated_at = utc_now()
        if remote.status in TERMINAL:
            task.completed_at = task.updated_at
        await db.commit()

    async def finish(self, owner, task_id, receipt):
        await self.state.reference_delivery.deliver(owner, receipt)
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            dispatch = await db.get(VisualGenerationDispatch, task_id)
            task = await db.get(VisualGenerationTask, task_id)
            if dispatch is None or task is None or dispatch.pending_receipt_id != receipt:
                return
            task.result_asset_id = dispatch.pending_asset_id
            task.status, task.progress = "completed", 100
            task.error_message = task.result_url = None
            task.completed_at = task.updated_at = utc_now()
            task.revision += 1
            dispatch.pending_asset_id = dispatch.pending_receipt_id = dispatch.retry_assertion = (
                None
            )
            await db.commit()

    async def fail_publication(self, owner, task_id, message):
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            dispatch = await db.get(VisualGenerationDispatch, task_id)
            task = await db.get(VisualGenerationTask, task_id)
            if dispatch is None or task is None or dispatch.pending_receipt_id:
                return
            task.status = "failed"
            task.error_message = message[:4000]
            task.result_url = f"models:{task_id}"
            task.completed_at = task.updated_at = utc_now()
            task.revision += 1
            await db.commit()

    async def acknowledge_results(self):
        dispatch = VisualGenerationDispatch
        async with self.sessions(info={"allow_system_reads": True}) as session:
            pending = list(
                await session.execute(
                    select(
                        dispatch.owner_user_id,
                        dispatch.task_id,
                        dispatch.plan_id,
                        dispatch.remote_output_sha256,
                    )
                    .join(VisualGenerationTask, VisualGenerationTask.id == dispatch.task_id)
                    .where(
                        VisualGenerationTask.status == "completed",
                        dispatch.remote_output_sha256.is_not(None),
                    )
                    .order_by(dispatch.checked_at)
                    .limit(50)
                )
            )
        for owner, task_id, plan_id, sha in pending:
            async with self.sessions(info={"owner_user_id": owner}) as db:
                decision = await db.get(VisualGenerationDecision, plan_id)
            path = self.peer.path(decision) + f"/tasks/{task_id}/result/{sha}/acknowledge"
            try:
                reply = await self.peer.signed("POST", path, owner)
            except GenerationError as exc:
                raise CapabilityUnavailable("模型结果清理回执暂不可用") from exc
            if reply.json().get("state") != "acknowledged":
                raise CapabilityUnavailable("模型结果清理回执无效")
            async with self.sessions(info={"owner_user_id": owner}) as db:
                await db.execute(
                    update(dispatch)
                    .where(dispatch.task_id == task_id, dispatch.remote_output_sha256 == sha)
                    .values(remote_output_sha256=None)
                )
                await db.commit()
