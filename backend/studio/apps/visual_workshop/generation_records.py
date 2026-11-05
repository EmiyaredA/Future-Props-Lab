from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.generation_state import can_recover_generation_result, cancel_queued
from studio.apps.visual_workshop.batch_retry import reopen_batch_after_retry
from studio.apps.visual_workshop.generation_common import (
    GenerationError,
    generation_batch_out,
    generation_task_out,
)
from studio.apps.visual_workshop.schemas.generation import (
    GenerationBatchListOut,
    GenerationBatchOut,
)
from studio.apps.visual_workshop.schemas.workshop import GenerationTaskListOut, GenerationTaskOut
from studio.apps.visual_workshop.storage.models import (
    VisualCanvasDocument,
    VisualGenerationBatch,
    VisualGenerationTask,
    VisualWorkshopProject,
)
from studio.runtime.time import utc_now

ACTIVE_TASK_STATUSES = ("queued", "submitting", "pending", "processing")


async def has_active_generation_tasks(
    session: AsyncSession, *, provider_id: str | None = None, model_id: str | None = None
) -> bool:
    conditions = [VisualGenerationTask.status.in_(ACTIVE_TASK_STATUSES)]
    if provider_id:
        conditions.append(VisualGenerationTask.provider_id == provider_id)
    if model_id:
        conditions.append(VisualGenerationTask.model_id == model_id)
    count = await session.scalar(select(func.count(VisualGenerationTask.id)).where(*conditions))
    return bool(count)


class GenerationRecords:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _project(self, project_id: str) -> VisualWorkshopProject:
        row = await self.session.get(VisualWorkshopProject, project_id)
        if row is None:
            raise GenerationError("项目不存在", code="not_found", status=404)
        return row

    async def get(self, task_id: str) -> GenerationTaskOut:
        row = await self.session.get(VisualGenerationTask, task_id)
        if row is None:
            raise GenerationError("生成任务不存在", code="not_found", status=404)
        return generation_task_out(row)

    async def cancel(self, task_id: str, expected_revision: int) -> GenerationTaskOut:
        row = await self.session.get(VisualGenerationTask, task_id)
        if row is None:
            raise GenerationError("生成任务不存在", code="not_found", status=404)
        if not await cancel_queued(self.session, row, expected_revision):
            await self.session.refresh(row)
            current = generation_task_out(row).model_dump(mode="json")
            raise GenerationError(
                "任务已变化或已开始提交，请刷新后重试",
                code="generation_cancel_conflict",
                status=409,
                current=current,
            )
        await self.session.commit()
        await self.session.refresh(row)
        return generation_task_out(row)

    async def get_batch(self, batch_id: str) -> GenerationBatchOut:
        row = await self.session.get(VisualGenerationBatch, batch_id)
        if row is None:
            raise GenerationError("生成批次不存在", code="not_found", status=404)
        return generation_batch_out(row)

    async def list_batches(
        self,
        project_id: str | None = None,
        page: int = 1,
        page_size: int = 50,
        current_nodes: bool = False,
    ) -> GenerationBatchListOut:
        conditions = []
        if project_id:
            conditions.append(VisualGenerationBatch.project_id == project_id)
        if current_nodes:
            if not project_id:
                raise GenerationError("节点状态查询必须指定项目")
            await self._project(project_id)
            canvas = await self.session.get(VisualCanvasDocument, project_id)
            nodes = canvas.nodes if canvas else []
            conditions.append(
                or_(
                    VisualGenerationBatch.id.in_(
                        [
                            node.get("generation_batch_id")
                            for node in nodes
                            if node.get("generation_batch_id")
                        ]
                    ),
                    and_(
                        VisualGenerationBatch.generation_node_id.in_(
                            [node["id"] for node in nodes]
                        ),
                        VisualGenerationBatch.status.in_(["queued", "processing"]),
                    ),
                )
            )
        total = await self.session.scalar(
            select(func.count(VisualGenerationBatch.id)).where(*conditions)
        )
        rows = list(
            await self.session.scalars(
                select(VisualGenerationBatch)
                .where(*conditions)
                .order_by(VisualGenerationBatch.created_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        )
        return GenerationBatchListOut(
            items=[generation_batch_out(row) for row in rows], total=int(total or 0)
        )

    async def list(
        self,
        *,
        project_id: str | None,
        canvas_node_id: str | None,
        kind: str | None,
        status: str | None,
        page: int,
        page_size: int,
        current_nodes: bool = False,
    ) -> GenerationTaskListOut:
        conditions = []
        if project_id:
            conditions.append(VisualGenerationTask.project_id == project_id)
        if current_nodes:
            if not project_id:
                raise GenerationError("节点状态查询必须指定项目")
            await self._project(project_id)
            canvas = await self.session.get(VisualCanvasDocument, project_id)
            nodes = canvas.nodes if canvas else []
            conditions.append(
                or_(
                    VisualGenerationTask.id.in_(
                        [
                            node.get("generation_task_id")
                            for node in nodes
                            if node.get("generation_task_id")
                        ]
                    ),
                    and_(
                        VisualGenerationTask.canvas_node_id.in_([node["id"] for node in nodes]),
                        VisualGenerationTask.status.in_(ACTIVE_TASK_STATUSES),
                    ),
                )
            )
        if canvas_node_id:
            conditions.append(VisualGenerationTask.canvas_node_id == canvas_node_id)
        if kind:
            conditions.append(VisualGenerationTask.generation_kind == kind)
        if status:
            conditions.append(VisualGenerationTask.status == status)
        total = int(
            await self.session.scalar(
                select(func.count(VisualGenerationTask.id)).where(*conditions)
            )
            or 0
        )
        rows = (
            (
                await self.session.execute(
                    select(VisualGenerationTask)
                    .where(*conditions)
                    .order_by(VisualGenerationTask.created_at.desc())
                    .offset((page - 1) * page_size)
                    .limit(page_size)
                )
            )
            .scalars()
            .all()
        )
        return GenerationTaskListOut(items=[generation_task_out(row) for row in rows], total=total)

    async def retry_materialization(self, task_id: str) -> GenerationTaskOut:
        row = await self.session.get(VisualGenerationTask, task_id)
        if row is None:
            raise GenerationError("生成任务不存在", code="not_found", status=404)
        if row.status in {"pending", "processing"} and row.provider_task_id:
            return generation_task_out(row)
        if not can_recover_generation_result(row):
            raise GenerationError("当前任务没有可恢复查询或保存的结果", code="retry_unavailable")
        revision = row.revision
        changed = await self.session.execute(
            update(VisualGenerationTask)
            .where(
                VisualGenerationTask.id == task_id,
                VisualGenerationTask.revision == revision,
                VisualGenerationTask.status == "failed",
            )
            .values(
                status="processing" if row.result_url else "pending",
                error_message=None,
                revision=revision + 1,
                updated_at=utc_now(),
            )
        )
        if changed.rowcount != 1:
            await self.session.rollback()
            current = await self.session.get(VisualGenerationTask, task_id)
            if current is not None and current.status in {"pending", "processing", "completed"}:
                return generation_task_out(current)
            raise GenerationError("任务状态已变更，请刷新后重试", code="conflict", status=409)
        await self.session.refresh(row)
        await reopen_batch_after_retry(self.session, row)
        await self.session.commit()
        return generation_task_out(row)
