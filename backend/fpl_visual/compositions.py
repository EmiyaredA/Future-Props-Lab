"""Queue or retry a composition with the currently verified project originals."""

from uuid import uuid4

from sqlalchemy import text

from app.apps.visual_workshop.composition_values import composition_items, new_composition
from app.apps.visual_workshop.generation_common import GenerationError, generation_batch_out
from app.apps.visual_workshop.models import VisualGenerationBatch
from app.runtime.time import utc_now
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable

from .composition_peer import GridPeer
from .models import VisualCompositionDispatch
from .projects import Projects
from .reference_backlog import pending_outcomes
from .segment_handoffs import require_canvas_unreserved


def check_revision(canvas, expected):
    if canvas.revision != expected:
        raise GenerationError(
            "画布已变化，请刷新后重试", code="canvas_revision_conflict", status=409
        )


def require_retryable(batch):
    if batch is None:
        raise GenerationError("生成批次不存在", code="not_found", status=404)
    if batch.batch_kind != "composition":
        raise GenerationError("当前批次不是节点合成批次", code="retry_unavailable")
    if batch.status != "failed" or batch.result_asset_id:
        raise GenerationError("当前批次没有可重新合成的结果", code="retry_unavailable")


class Compositions:
    def __init__(self, request, session, owner):
        self.session, self.owner = session, owner
        self.projects = Projects(session, owner)
        self.state = request.app.state
        self.assertion, self.path = request.state.service_assertion, request.url.path
        self.peer = GridPeer(self.state.capabilities, self.assertion, self.path)

    async def plan(self, project, batch, items):
        for identity in await pending_outcomes(self.session, project):
            try:
                await self.state.reference_delivery.deliver(self.owner, identity)
            except (CapabilityDenied, CapabilityUnavailable) as exc:
                raise GenerationError(
                    "宫格素材正在结算", code="visual_grid_unavailable", status=503
                ) from exc
        return await self.peer.plan(project, batch, items)

    def dispatch(self, batch_id, plan):
        self.session.add(
            VisualCompositionDispatch(
                batch_id=batch_id,
                owner_user_id=self.owner,
                assertion=self.assertion,
                source_path=self.path,
                plan=plan.model_dump(mode="json"),
            )
        )

    async def create(self, project, body):
        canvas = await self.projects.canvas_row(project)
        check_revision(canvas, body.expected_canvas_revision)
        items = composition_items(canvas, body)
        batch_id = str(uuid4())
        plan = await self.plan(project, batch_id, items)
        await self.session.execute(text("BEGIN IMMEDIATE"))
        await require_canvas_unreserved(self.session, self.owner, project)
        canvas = await self.projects.canvas_row(project)
        check_revision(canvas, body.expected_canvas_revision)
        result_node, batch = new_composition(self.owner, canvas, body, items, batch_id)
        canvas.nodes = [*(canvas.nodes or []), result_node]
        canvas.revision += 1
        canvas.updated_at = utc_now()
        self.session.add(batch)
        await self.session.flush()
        self.dispatch(batch_id, plan)
        result = generation_batch_out(batch)
        await self.session.commit()
        return result

    async def retry(self, batch_id):
        batch = await self.session.get(VisualGenerationBatch, batch_id)
        require_retryable(batch)
        project, revision, items = batch.project_id, batch.revision, batch.source_items
        plan = await self.plan(project, batch_id, items)
        await self.session.execute(text("BEGIN IMMEDIATE"))
        await require_canvas_unreserved(self.session, self.owner, project)
        batch = await self.session.get(VisualGenerationBatch, batch_id, populate_existing=True)
        require_retryable(batch)
        if batch.revision != revision:
            raise GenerationError(
                "生成批次已变化，请刷新后重试", code="retry_unavailable", status=409
            )
        batch.status = "queued"
        batch.error_message = None
        batch.completed_at = None
        batch.updated_at = utc_now()
        batch.revision += 1
        self.dispatch(batch.id, plan)
        await self.session.commit()
        return generation_batch_out(batch)
