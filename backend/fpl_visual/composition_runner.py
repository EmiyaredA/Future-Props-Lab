"""Publish a deterministic composition once its Canvas and Assets receipts settle."""

from copy import deepcopy

from sqlalchemy import select, text

from app.apps.visual_workshop.canvas_values import canvas_out
from app.apps.visual_workshop.generation_common import GenerationError
from app.apps.visual_workshop.models import VisualGenerationBatch, VisualGenerationTask
from app.apps.visual_workshop.outputs.recording import register_output
from app.runtime.polling_runner import PollingTaskRunner
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import utc_now
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.project_errors import ProjectResourceError
from fpl_runtime.visual_composition import GridPlan

from .canvas_writes import conflict
from .composition_peer import GridPeer
from .models import VisualCompositionDispatch
from .projects import Projects
from .uploads import Uploads


class CompositionRunner(PollingTaskRunner):
    runner_name = "visual-compositions"
    poll_interval_seconds = 1

    def __init__(self, state):
        super().__init__()
        self.state = state
        self.sessions = state.database.sessions

    async def recover(self):
        # Pure rendering can safely run again; a persisted source receipt is only settled.
        return

    async def process_once(self):
        dispatch = VisualCompositionDispatch
        async with self.sessions(info={"allow_system_reads": True}) as session:
            jobs = list(
                await session.execute(
                    select(dispatch.owner_user_id, dispatch.batch_id)
                    .order_by(dispatch.checked_at, dispatch.batch_id)
                    .limit(20)
                )
            )
        error = None
        for owner, identity in jobs:
            try:
                await self.run(owner, identity)
            except (CapabilityUnavailable, CapabilityDenied) as exc:
                error = error or exc
        if error is not None:
            raise error

    async def run(self, owner, identity):
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            dispatch = await db.get(VisualCompositionDispatch, identity)
            batch = await db.get(VisualGenerationBatch, identity)
            if dispatch is None or batch is None or batch.status not in ("queued", "processing"):
                return
            dispatch.checked_at = utc_now()
            if batch.status == "queued":
                batch.status = "processing"
                batch.completed_count = 0
                batch.failed_count = 0
                batch.updated_at = utc_now()
                batch.revision += 1
            await db.commit()
            receipt = dispatch.pending_receipt_id
            if receipt is not None:
                await self.finish(owner, identity, receipt)
                return
            peer = GridPeer(self.state.capabilities, dispatch.assertion, dispatch.source_path)
            try:
                image = await peer.render(
                    batch.project_id, identity, GridPlan.model_validate(dispatch.plan)
                )
                try:
                    receipt = await self.publish(db, owner, batch, dispatch, image)
                finally:
                    await image.close()
            except RevisionConflictError:
                return
            except (GenerationError, ProjectResourceError) as exc:
                await db.rollback()
                if exc.status in (429, 503) or exc.code in {
                    "segment_target_reserved",
                    "project_references_pending",
                    "visual_upload_pending",
                }:
                    raise CapabilityUnavailable("宫格合成等待服务恢复") from exc
                await self.fail(owner, identity, str(exc))
                return
        await self.finish(owner, identity, receipt)

    async def publish(self, db, owner, batch, dispatch, image):
        project, node_id, identity = batch.project_id, batch.generation_node_id, batch.id
        source_items = batch.source_items
        if batch.batch_kind == "generation":
            first = await db.get(VisualGenerationTask, batch.child_task_ids[0])
            source_items = first.request_payload.get("input_snapshot", [])
        projects = Projects(db, owner)
        current = canvas_out(await projects.canvas_row(project))
        self.require_node(
            [node.model_dump(mode="json") for node in current.nodes], node_id, identity
        )
        uploads = Uploads(self.state, db, owner, dispatch.assertion, dispatch.source_path)
        receipt = None

        async def apply(assets, request_id):
            nonlocal receipt
            canvas = await projects.canvas_row(project)
            if canvas.revision != current.revision:
                raise conflict(current.revision, canvas_out(canvas))
            rows = deepcopy(canvas.nodes)
            node = self.require_node(rows, node_id, identity)
            task = await db.get(VisualCompositionDispatch, identity, populate_existing=True)
            if task is None or task.pending_receipt_id is not None:
                raise GenerationError(
                    "宫格批次已变化", code="visual_grid_batch_changed", status=409
                )
            await register_output(
                db,
                project,
                node,
                source="generated",
                source_key=f"batch:{identity}",
                asset_id=assets[0].id,
                input_snapshot=source_items,
            )
            canvas.nodes = rows
            canvas.revision += 1
            canvas.updated_at = utc_now()
            task.pending_asset_id = assets[0].id
            task.pending_receipt_id = request_id
            receipt = request_id
            return canvas_out(canvas)

        await uploads.stage_and_commit(
            current,
            current.revision,
            image,
            "image",
            apply,
            composition_batch_id=identity,
        )
        return receipt

    @staticmethod
    def require_node(nodes, node_id, identity):
        node = next((row for row in nodes if row["id"] == node_id), None)
        if node is None or node["kind"] != "image" or node.get("generation_batch_id") != identity:
            raise GenerationError("合成结果节点不存在", code="canvas_node_not_found", status=404)
        return node

    async def finish(self, owner, identity, receipt):
        await self.state.reference_delivery.deliver(owner, receipt)
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            dispatch = await db.get(VisualCompositionDispatch, identity)
            batch = await db.get(VisualGenerationBatch, identity)
            if dispatch is None or dispatch.pending_receipt_id != receipt or batch is None:
                return
            batch.result_asset_id = dispatch.pending_asset_id
            batch.status = "completed"
            batch.completed_count = batch.grid_size
            batch.failed_count = 0
            batch.error_message = None
            batch.completed_at = batch.updated_at = utc_now()
            batch.revision += 1
            await db.delete(dispatch)
            await db.commit()

    async def fail(self, owner, identity, message):
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            dispatch = await db.get(VisualCompositionDispatch, identity)
            batch = await db.get(VisualGenerationBatch, identity)
            if dispatch is None or dispatch.pending_receipt_id is not None or batch is None:
                return
            batch.status = "failed"
            batch.error_message = f"宫格合成失败：{message}"[:1000]
            batch.completed_at = batch.updated_at = utc_now()
            batch.revision += 1
            await db.delete(dispatch)
            await db.commit()
