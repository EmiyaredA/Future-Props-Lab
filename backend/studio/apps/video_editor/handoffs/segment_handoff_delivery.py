"""Settle a sealed segment task against the exact destination's durable receipt."""

import httpx
from sqlalchemy import select, text

from studio.apps.video_editor.errors import VideoEditorValidationError
from studio.apps.video_editor.handoffs.segment_results import settle_segments
from studio.apps.video_editor.storage.models import VideoEditorTask
from studio.apps.video_editor.storage.service_models import (
    VideoRenderDispatch,
    VideoSegmentDelivery,
)
from studio.contracts.video_editor.video_segment_handoff import VISUAL_HANDOFFS
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable
from studio.runtime.time import utc_now


async def guard_project_removal(session, owner, project):
    decided = await session.scalar(
        select(VideoSegmentDelivery.task_id)
        .where(
            VideoSegmentDelivery.owner_user_id == owner,
            VideoSegmentDelivery.project_id == project,
            VideoSegmentDelivery.state == "commit",
        )
        .limit(1)
    )
    if decided is not None:
        raise VideoEditorValidationError("项目的分段交接正在确认", code="segment_handoff_pending")


class SegmentDelivery:
    def __init__(self, sessions, client, peer):
        self.sessions, self.client, self.peer = sessions, client, peer

    def session(self, owner):
        return self.sessions(info={"owner_user_id": owner})

    async def send(self, owner, scope, operation):
        path = scope.path(VISUAL_HANDOFFS, operation)
        try:
            response = await self.client.post(
                "http://visual:8080" + path,
                headers=self.peer.headers("POST", path, owner),
                json=scope.model_dump(mode="json"),
            )
            if response.status_code in {403, 404, 409, 422}:
                raise CapabilityDenied(response.status_code, response.json().get("code"))
            response.raise_for_status()
            result = response.json()
            if not isinstance(result, dict):
                raise ValueError("invalid Visual handoff receipt")
            return result
        except (httpx.HTTPError, ValueError, TypeError):
            raise CapabilityUnavailable("视觉工坊分段交接回执尚未确认") from None

    async def decision(self, owner, scope, *, prepared=False, error=None):
        async with self.session(owner) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await session.get(VideoSegmentDelivery, scope.task_id)
            task = await session.get(VideoEditorTask, scope.task_id)
            if row is None:
                row = VideoSegmentDelivery(
                    task_id=scope.task_id,
                    owner_user_id=owner,
                    project_id=scope.source_project_id,
                    scope_sha256=scope.digest,
                    state="preparing",
                )
                session.add(row)
            elif row.scope_sha256 != scope.digest:
                raise ValueError("分段交接回执范围已变化")
            if row.state == "preparing":
                if task is None or task.cancel_requested or error is not None:
                    row.state, row.error = "abort", error
                elif prepared:
                    row.state = "commit"
            await session.commit()
            return row.state

    async def change_decision(self, owner, scope, old, new, *, error=None):
        async with self.session(owner) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await session.get(VideoSegmentDelivery, scope.task_id)
            if row.state == old:
                row.state, row.error = new, error
                await session.commit()

    async def deliver(self, binding, receipt):
        scope, owner = receipt.handoff, binding.owner_user_id
        if (scope.source_project_id, scope.task_id) != (binding.project_id, binding.task_id):
            raise ValueError("分段交接任务不符")
        phase = await self.decision(owner, scope)
        if phase == "preparing":
            try:
                prepared = await self.send(owner, scope, "prepare")
            except CapabilityDenied as exc:
                if exc.code == "segment_target_reserved":
                    return  # The earlier decision still owns the target fence.
                phase = await self.decision(
                    owner, scope, error="目标工作坊不存在、已变化或拒绝接收分段"
                )
            else:
                if prepared.get("state") not in {"prepared", "commit", "published"}:
                    raise CapabilityUnavailable("目标工作坊准备回执无效")
                phase = await self.decision(owner, scope, prepared=True)
        if phase == "commit":
            try:
                result = await self.send(owner, scope, "commit")
            except CapabilityDenied as exc:
                if exc.code == "segment_handoff_revoked":
                    await self.change_decision(
                        owner, scope, "commit", "abort", error="画布接收授权已撤销"
                    )
                    return
                raise CapabilityUnavailable("目标画布提交尚未确认") from exc
            if (
                result.get("state") != "published"
                or result.get("project_id") != scope.target.project_id
            ):
                raise CapabilityUnavailable("目标工作坊提交回执无效")
            await self.finish(binding, receipt, result=result)
        elif phase == "abort":
            try:
                result = await self.send(owner, scope, "abort")
            except CapabilityDenied as exc:
                if exc.code == "segment_handoff_decided":
                    await self.change_decision(owner, scope, "abort", "commit")
                    return
                raise CapabilityUnavailable("目标画布取消尚未确认") from exc
            if result.get("state") != "aborted":
                raise CapabilityUnavailable("目标工作坊取消回执无效")
            await self.finish(binding, receipt, result=None)

    async def finish(self, binding, receipt, *, result):
        async with self.session(binding.owner_user_id) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            current = await session.get(VideoRenderDispatch, binding.task_id)
            if current is None or current.settled:
                return
            task = await session.get(VideoEditorTask, binding.task_id)
            decision = await session.get(VideoSegmentDelivery, binding.task_id)
            if task is None:
                await session.delete(current)
            else:
                now = utc_now()
                if result is not None:
                    await settle_segments(session, task, receipt.segments, handoff=result)
                    task.status, task.progress, task.error = "completed", 100, None
                else:
                    task.status = "failed" if decision.error else "cancelled"
                    task.error = decision.error
                task.revision += 1
                task.finished_at = task.updated_at = now
                current.settled, current.frozen = True, {}
            decision.state = "published" if result is not None else "aborted"
            await session.commit()
