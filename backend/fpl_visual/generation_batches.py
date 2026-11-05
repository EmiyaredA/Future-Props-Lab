"""Aggregate image batches and schedule their optional deterministic composite."""

from sqlalchemy import select, text

from app.apps.visual_workshop.generation_common import GenerationError
from app.apps.visual_workshop.models import VisualGenerationBatch, VisualGenerationTask
from app.apps.visual_workshop.node_placement import automatic_node_position
from app.runtime.ids import new_id
from app.runtime.time import utc_now
from fpl_runtime.capability_client import CapabilityUnavailable

from .composition_peer import GridPeer
from .generation_dispatch_records import VisualGenerationDecision
from .models import VisualCompositionDispatch
from .projects import Projects
from .segment_handoffs import require_canvas_unreserved

ACTIVE = {"queued", "processing"}


class GenerationBatches:
    def __init__(self, state):
        self.state, self.sessions = state, state.database.sessions

    async def process_once(self):
        async with self.sessions(info={"allow_system_reads": True}) as db:
            rows = list(
                await db.execute(
                    select(VisualGenerationBatch.owner_user_id, VisualGenerationBatch.id)
                    .join(
                        VisualGenerationDecision,
                        VisualGenerationDecision.id == VisualGenerationBatch.id,
                    )
                    .outerjoin(
                        VisualCompositionDispatch,
                        VisualCompositionDispatch.batch_id == VisualGenerationBatch.id,
                    )
                    .where(
                        VisualGenerationBatch.batch_kind == "generation",
                        VisualGenerationBatch.status.in_(ACTIVE),
                        VisualCompositionDispatch.batch_id.is_(None),
                    )
                    .order_by(VisualGenerationBatch.updated_at, VisualGenerationBatch.id)
                    .limit(50)
                )
            )
        first_error = None
        for owner, identity in rows:
            try:
                await self.refresh(owner, identity)
            except CapabilityUnavailable as exc:
                first_error = first_error or exc
        if first_error is not None:
            raise first_error

    async def refresh(self, owner, identity):
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            batch = await db.get(VisualGenerationBatch, identity)
            dispatch = await db.get(VisualCompositionDispatch, identity)
            if batch is None or batch.status not in ACTIVE or dispatch is not None:
                return
            children = {
                row.id: row
                for row in await db.scalars(
                    select(VisualGenerationTask).where(
                        VisualGenerationTask.id.in_(batch.child_task_ids)
                    )
                )
            }
            if set(children) != set(batch.child_task_ids):
                raise ValueError("生成批次缺少子任务")
            ordered = [children[child] for child in batch.child_task_ids]
            completed, failed, cancelled = (
                sum(row.status == state for row in ordered)
                for state in ("completed", "failed", "cancelled")
            )
            if completed + failed + cancelled < batch.grid_size:
                self.update(
                    batch,
                    "queued" if all(row.status == "queued" for row in ordered) else "processing",
                    completed,
                    failed,
                    cancelled,
                )
                await db.commit()
                return
            if failed or cancelled or batch.grid_output == "nodes":
                status = "cancelled" if cancelled else "failed" if failed else "completed"
                self.update(
                    batch,
                    status,
                    completed,
                    failed,
                    cancelled,
                    f"{failed} 个子任务失败，{cancelled} 个子任务取消"
                    if failed or cancelled
                    else None,
                )
                await db.commit()
                return
            decision = await db.get(VisualGenerationDecision, identity)
            project = batch.project_id
            source, assertion = decision.source_path, decision.source_assertion
            items = [{"asset_id": row.result_asset_id, "caption": ""} for row in ordered]
            await db.commit()
        try:
            peer = GridPeer(self.state.capabilities, assertion, source)
            plan = await peer.plan(project, identity, items)
        except GenerationError as exc:
            if exc.status in (429, 503):
                raise CapabilityUnavailable("生成批次等待合成素材") from exc
            await self.fail(owner, identity, str(exc))
            return
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            batch = await db.get(VisualGenerationBatch, identity)
            if (
                batch is None
                or batch.status not in ACTIVE
                or await db.get(VisualCompositionDispatch, identity)
            ):
                return
            await require_canvas_unreserved(db, owner, project)
            if batch.generation_node_id is None:
                canvas = await Projects(db, owner).canvas_row(project)
                node_id = new_id()
                canvas.nodes = [
                    *canvas.nodes,
                    {
                        "id": node_id,
                        "kind": "image",
                        "title": f"{batch.grid_size}宫格合成",
                        "position": automatic_node_position(canvas.nodes, "image"),
                        "generation_batch_id": identity,
                    },
                ]
                canvas.revision += 1
                canvas.updated_at = utc_now()
                batch.generation_node_id = node_id
            batch.source_items = items
            self.update(batch, "processing", completed, failed, cancelled)
            db.add(
                VisualCompositionDispatch(
                    batch_id=identity,
                    owner_user_id=owner,
                    source_path=source,
                    assertion=assertion,
                    plan=plan.model_dump(mode="json"),
                )
            )
            await db.commit()

    async def fail(self, owner, identity, message):
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            batch = await db.get(VisualGenerationBatch, identity)
            if batch is not None and batch.status in ACTIVE:
                self.update(batch, "failed", batch.grid_size, 0, 0, message[:1000])
                await db.commit()

    @staticmethod
    def update(batch, status, completed, failed, cancelled, message=None):
        old = (
            batch.status,
            batch.completed_count,
            batch.failed_count,
            batch.cancelled_count,
            batch.error_message,
        )
        new = (status, completed, failed, cancelled, message)
        if old == new:
            return
        (
            batch.status,
            batch.completed_count,
            batch.failed_count,
            batch.cancelled_count,
            batch.error_message,
        ) = new
        batch.revision += 1
        batch.updated_at = utc_now()
        if status not in ACTIVE:
            batch.completed_at = batch.updated_at
