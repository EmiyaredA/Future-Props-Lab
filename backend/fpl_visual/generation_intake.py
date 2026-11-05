"""Freeze Visual-owned Canvas inputs and commit the source before Models may run."""

from uuid import uuid4

from pydantic import ValidationError
from sqlalchemy import text, update

from app.apps.visual_workshop.batch_nodes import attach_grid_nodes
from app.apps.visual_workshop.canvas_values import canvas_out
from app.apps.visual_workshop.generation_common import (
    GenerationError,
    generation_batch_out,
    generation_task_out,
)
from app.apps.visual_workshop.models import VisualGenerationBatch, VisualGenerationTask
from app.apps.visual_workshop.outputs.queries import OutputError
from app.apps.visual_workshop.outputs.references import resolve_references
from app.apps.visual_workshop.schemas.workshop import VisualCanvasDocumentPutIn
from app.llm.schemas.generation_tasks import ImageGenerationTaskCreateIn
from app.runtime.time import utc_now
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.visual_assistant import approval_source
from fpl_runtime.visual_generation_plan import GenerationPlan, TaskPlan, reference_ids

from .generation_dispatch_records import VisualGenerationDecision, VisualGenerationDispatch
from .generation_peer import GenerationPeer
from .projects import Projects
from .reference_backlog import pending_outcomes
from .segment_handoffs import require_canvas_unreserved


class GenerationIntake:
    def __init__(self, state, session, owner, *, assertion, source):
        self.session, self.owner = session, owner
        self.state = state
        self.projects = Projects(session, owner)
        self.source, self.assertion = source, assertion
        self.peer = GenerationPeer(self.state, assertion=self.assertion, source=self.source)
        if self.peer.sign is None:
            raise GenerationError(
                "生成执行服务尚未就绪", code="visual_generation_unavailable", status=503
            )

    @classmethod
    def from_request(cls, request, session, owner):
        return cls(
            request.app.state,
            session,
            owner,
            assertion=request.state.service_assertion,
            source=request.url.path,
        )

    async def create_task(self, project, body):
        return await self.create(project, body)

    async def create_batch(self, project, body):
        task = ImageGenerationTaskCreateIn(
            kind="image",
            model_id=body.model_id,
            prompt=body.prompt,
            size=body.size,
            seed=body.seed,
            reference_asset_id=body.reference_asset_id,
            reference_asset_ids=body.reference_asset_ids,
            canvas_node_id=body.canvas_node_id,
            expected_canvas_revision=body.expected_canvas_revision,
        )
        return await self.create(project, task, batch=body)

    async def create(self, project, arguments, batch=None, *, draft_node=None):
        approval = approval_source("POST", self.source)
        if approval and (
            approval[1] != project or batch is not None or arguments.canvas_node_id is None
        ):
            raise GenerationError("审批和生成任务不匹配", code="approval_not_found", status=404)
        await self.projects.row(project)
        for identity in await pending_outcomes(self.session, project):
            try:
                await self.state.reference_delivery.deliver(self.owner, identity)
            except (CapabilityDenied, CapabilityUnavailable) as exc:
                raise GenerationError(
                    "生成输入正在结算", code="visual_generation_unavailable", status=503
                ) from exc
        try:
            choice = await self.peer.model(arguments)
            plan_arguments = arguments
            if draft_node is not None:
                plan_arguments = arguments.model_copy(
                    update={"canvas_node_id": None, "expected_canvas_revision": None}
                )
            plan = await self.plan(project, plan_arguments, choice, batch)
        except ValidationError as exc:
            raise GenerationError("生成请求参数或素材引用无效", code="invalid_reference") from exc
        identity = str(plan.plan_id)
        if approval:
            await self.peer.admit(self.owner, plan)
        self.session.add(
            VisualGenerationDecision(
                id=identity,
                owner_user_id=self.owner,
                project_id=project,
                plan_sha256=plan.digest,
                state="preparing",
                source_path=self.source,
                source_assertion="" if approval else self.assertion,
            )
        )
        await self.session.commit()
        try:
            payloads = await self.peer.prepare(plan)
            await self.session.execute(text("BEGIN IMMEDIATE"))
            result = await self.persist(
                plan, payloads, arguments, batch, draft_node=draft_node, approved=bool(approval)
            )
            await self.session.commit()
            return result
        except BaseException:
            await self.session.rollback()
            await self.release(identity)
            raise

    async def plan(self, project, arguments, choice, batch):
        await self.session.execute(text("BEGIN"))
        try:
            args, titles, provenance = await resolve_references(
                self.session,
                project,
                arguments,
                frame_constraints=choice.provider_kind != "zealman_video",
                frame_reference_slots=(
                    choice.provider_kind == "autodl_video"
                    and choice.model_slug == "minimax_h3_lightx2v"
                ),
            )
        except OutputError as exc:
            raise GenerationError(str(exc), code=exc.code, status=exc.status) from None
        await self.session.rollback()
        identity = uuid4()
        args = args.model_copy(update={"canvas_node_id": None, "expected_canvas_revision": None})
        identities = reference_ids(args)
        assets = await self.peer.assets(project, str(identity), identities)
        tasks = []
        for index in range(batch.grid_size if batch is not None else 1):
            request_args = args
            if batch is not None and args.seed is not None:
                request_args = args.model_copy(update={"seed": args.seed + index})
            tasks.append(
                TaskPlan(
                    task_id=uuid4(),
                    arguments=request_args,
                    explicit_fields=sorted(arguments.model_fields_set),
                    reference_titles={
                        identity: name
                        for identity, name in titles.items()
                        if identity in identities and batch is None
                    },
                    input_snapshot=provenance,
                )
            )
        return GenerationPlan(
            project_id=project,
            plan_id=identity,
            model=choice,
            tasks=tasks,
            assets=assets,
        )

    async def persist(self, plan, payloads, arguments, batch, *, draft_node=None, approved=False):
        project, identity = plan.project_id, str(plan.plan_id)
        await self.projects.row(project)
        await require_canvas_unreserved(self.session, self.owner, project)
        decision = await self.session.get(
            VisualGenerationDecision, identity, populate_existing=True
        )
        if decision is None or decision.state != "preparing":
            raise GenerationError(
                "生成批次状态已变化", code="visual_generation_conflict", status=409
            )
        rows = []
        for index, task in enumerate(plan.tasks):
            task_id = str(task.task_id)
            payload = payloads[task_id]
            if (
                payload.get("kind") != task.arguments.kind
                or payload.get("model_id") != plan.model.model_id
            ):
                raise GenerationError(
                    "生成参数回执不一致", code="visual_generation_unavailable", status=503
                )
            if batch is not None:
                payload.update(generation_batch_id=identity, generation_batch_index=index)
            rows.append(
                VisualGenerationTask(
                    id=task_id,
                    owner_user_id=self.owner,
                    project_id=project,
                    provider_id=plan.model.provider_id,
                    model_id=plan.model.model_id,
                    provider_kind=plan.model.provider_kind,
                    provider_name=plan.model.provider_name,
                    model_slug=plan.model.model_slug,
                    generation_kind=task.arguments.kind,
                    request_payload=payload,
                    canvas_node_id=arguments.canvas_node_id if batch is None else None,
                    status="queued",
                )
            )
        self.session.add_all(rows)
        await self.session.flush()
        self.session.add_all(
            [
                VisualGenerationDispatch(task_id=row.id, owner_user_id=self.owner, plan_id=identity)
                for row in rows
            ]
        )
        decision.state, decision.updated_at = "activate", utc_now()
        if batch is None:
            canvas = None
            if arguments.canvas_node_id is not None:
                canvas = await self.attach(
                    project, arguments, draft_node=draft_node, generation_task_id=rows[0].id
                )
            result = generation_task_out(rows[0])
            return (result, canvas_out(canvas)) if approved else result
        record = VisualGenerationBatch(
            id=identity,
            owner_user_id=self.owner,
            project_id=project,
            grid_size=batch.grid_size,
            grid_output=batch.grid_output,
            child_task_ids=[row.id for row in rows],
            generation_node_id=batch.canvas_node_id,
            status="queued",
        )
        self.session.add(record)
        await self.session.flush()
        if batch.canvas_node_id and batch.grid_output == "nodes":
            await attach_grid_nodes(
                self,
                project_id=project,
                node_id=batch.canvas_node_id,
                expected_revision=batch.expected_canvas_revision,
                batch_id=identity,
                task_ids=record.child_task_ids,
                grid_size=batch.grid_size,
            )
        elif batch.canvas_node_id:
            await self.attach(
                project, arguments, generation_batch_id=identity, generation_task_id=None
            )
        return generation_batch_out(record)

    async def attach(self, project, args, *, draft_node=None, **changes):
        canvas = await self.projects.canvas_row(project)
        if canvas.revision != args.expected_canvas_revision:
            raise GenerationError(
                "画布已变化，请刷新后重试", code="canvas_revision_conflict", status=409
            )
        nodes = [dict(node) for node in (canvas.nodes or [])]
        node = next((row for row in nodes if row["id"] == args.canvas_node_id), None)
        if draft_node is not None:
            if node is not None or draft_node.id != args.canvas_node_id:
                raise GenerationError("画布节点已变化", code="canvas_revision_conflict", status=409)
            node = draft_node.model_dump(mode="json")
            nodes.append(node)
            try:
                current = canvas_out(canvas)
                VisualCanvasDocumentPutIn(
                    expected_revision=current.revision, nodes=nodes, edges=current.edges
                )
            except ValidationError as exc:
                raise GenerationError(
                    "生成占位节点无效", code="invalid_canvas", status=422
                ) from exc
        if node is None:
            raise GenerationError("画布节点不存在", code="canvas_node_not_found", status=404)
        if node["kind"] != args.kind:
            raise GenerationError("画布节点类型与生成任务不匹配", code="canvas_kind_mismatch")
        node.update(changes)
        canvas.nodes = nodes
        canvas.revision += 1
        canvas.updated_at = utc_now()
        return canvas

    async def release(self, identity):
        async with self.state.database.sessions(info={"owner_user_id": self.owner}) as db:
            await db.execute(
                update(VisualGenerationDecision)
                .where(
                    VisualGenerationDecision.id == identity,
                    VisualGenerationDecision.state == "preparing",
                )
                .values(state="abort", updated_at=utc_now())
            )
            await db.commit()
