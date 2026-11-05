"""Preserve the Visual task controls while the execution owner decides state changes."""

from sqlalchemy import text

from studio.apps.visual_workshop.generation_common import GenerationError, generation_task_out
from studio.apps.visual_workshop.generation_records import (
    GenerationRecords,
    reopen_batch_after_retry,
)
from studio.apps.visual_workshop.storage.generation_dispatch_records import (
    VisualGenerationDecision,
    VisualGenerationDispatch,
)
from studio.apps.visual_workshop.storage.models import VisualGenerationTask
from studio.contracts.model_service.generation_recovery import can_recover_generation_result
from studio.runtime.http.capability_client import CapabilityUnavailable
from studio.runtime.time import utc_now


def cancel_conflict(row):
    return GenerationError(
        "任务已变化或已开始提交，请刷新后重试",
        code="generation_cancel_conflict",
        status=409,
        current=generation_task_out(row).model_dump(mode="json"),
    )


class GenerationControls:
    def __init__(self, request, session, owner):
        self.session, self.owner = session, owner
        self.assertion = request.state.service_assertion
        self.runner = request.app.state.generation_runner

    async def change(self, task_id, action, expected=None):
        row = await self.session.get(VisualGenerationTask, task_id)
        if row is None:
            raise GenerationError("生成任务不存在", code="not_found", status=404)
        dispatch = await self.session.get(VisualGenerationDispatch, task_id)
        if dispatch is None:
            legacy = GenerationRecords(self.session)
            if action == "cancel":
                return await legacy.cancel(task_id, expected)
            return await legacy.retry_materialization(task_id)
        if action == "cancel" and (
            row.revision != expected or row.status != "queued" or row.generation_kind == "audio"
        ):
            raise cancel_conflict(row)
        if action == "retry":
            if row.status in {"pending", "processing"} and row.provider_task_id:
                return generation_task_out(row)
            if not can_recover_generation_result(row):
                raise GenerationError(
                    "当前任务没有可恢复查询或保存的结果", code="retry_unavailable"
                )
        revision, plan_id = row.revision, dispatch.plan_id
        await self.session.rollback()
        if self.runner is None:
            raise GenerationError(
                "生成执行服务暂不可用", code="visual_generation_unavailable", status=503
            )
        try:
            await self.runner.decisions.deliver(self.owner, plan_id)
            async with self.runner.sessions(info={"owner_user_id": self.owner}) as read:
                decision = await read.get(VisualGenerationDecision, plan_id)
            remote = await self.runner.peer.status(decision, task_id)
            if action == "cancel" and remote.status == "queued":
                remote = await self.runner.peer.status(
                    decision, task_id, f"/cancel/{remote.revision}"
                )
            elif action == "retry" and remote.status == "failed":
                remote = await self.runner.peer.status(
                    decision, task_id, f"/retry/{remote.revision}"
                )
        except CapabilityUnavailable as exc:
            raise GenerationError(
                "生成执行服务暂不可用", code="visual_generation_unavailable", status=503
            ) from exc
        except GenerationError as exc:
            if action == "cancel" and exc.status == 409:
                current = await self.session.get(VisualGenerationTask, task_id)
                raise cancel_conflict(current) from exc
            raise
        await self.session.execute(text("BEGIN IMMEDIATE"))
        row = await self.session.get(VisualGenerationTask, task_id, populate_existing=True)
        dispatch = await self.session.get(VisualGenerationDispatch, task_id, populate_existing=True)
        if row is None or dispatch is None:
            raise GenerationError("生成任务不存在", code="not_found", status=404)
        if action == "cancel":
            if remote.status != "cancelled":
                raise cancel_conflict(row)
            if row.status == "cancelled":
                return generation_task_out(row)
            row.status, row.completed_at = "cancelled", utc_now()
        else:
            if row.revision != revision:
                if row.status in {"pending", "processing", "completed"}:
                    return generation_task_out(row)
                raise GenerationError("任务状态已变更，请刷新后重试", code="conflict", status=409)
            row.status = "pending" if remote.status == "pending" else "processing"
            row.completed_at = None
            dispatch.retry_assertion = self.assertion
            await reopen_batch_after_retry(self.session, row)
        row.error_message = None
        row.provider_task_id = remote.provider_task_id
        row.revision += 1
        row.updated_at = utc_now()
        dispatch.provider_revision = remote.revision - (1 if action == "retry" else 0)
        await self.session.commit()
        return generation_task_out(row)
