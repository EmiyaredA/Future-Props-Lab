"""Atomic intake storage; network calls never run inside its write transactions."""

from sqlalchemy import text, update

from studio.apps.visual_workshop.batch_nodes import attach_grid_nodes
from studio.apps.visual_workshop.generation_common import generation_batch_out, generation_task_out
from studio.apps.visual_workshop.generation_errors import GenerationError
from studio.apps.visual_workshop.handoffs.segment_handoffs import require_canvas_unreserved
from studio.apps.visual_workshop.outputs.queries import OutputError
from studio.apps.visual_workshop.outputs.references import resolve_references
from studio.apps.visual_workshop.projects import Projects
from studio.apps.visual_workshop.reference_backlog import pending_outcomes
from studio.apps.visual_workshop.storage.generation_dispatch_records import (
    VisualGenerationDecision,
    VisualGenerationDispatch,
)
from studio.apps.visual_workshop.storage.models import VisualGenerationBatch, VisualGenerationTask
from studio.runtime.time import utc_now


class SqlGenerationIntake:
    def __init__(self, session, owner, *, sessions, source, assertion):
        self.session, self.owner = session, owner
        self.sessions, self.source, self.assertion = sessions, source, assertion
        self.projects = Projects(session, owner)

    async def pending(self, project):
        try:
            await self.projects.row(project)
            return await pending_outcomes(self.session, project)
        finally:
            await self.session.rollback()

    async def resolve(self, project, arguments, rules):
        await self.session.execute(text("BEGIN"))
        try:
            return await resolve_references(self.session, project, arguments, **rules.model_dump())
        except OutputError as exc:
            raise GenerationError(str(exc), code=exc.code, status=exc.status) from None
        finally:
            await self.session.rollback()

    async def start(self, plan):
        self.session.add(
            VisualGenerationDecision(
                id=str(plan.plan_id),
                owner_user_id=self.owner,
                project_id=plan.project_id,
                plan_sha256=plan.digest,
                state="preparing",
                source_path=self.source,
                source_assertion=self.assertion,
            )
        )
        await self.session.commit()

    async def commit(self, plan, payloads, arguments, batch, on_created):
        await self.session.execute(text("BEGIN IMMEDIATE"))
        try:
            result = await self.persist(plan, payloads, arguments, batch)
            # The binding stages card revision and idempotency receipt in this
            # same request-owned transaction; it must never commit on its own.
            if on_created is not None:
                await on_created(result.id)
            await self.session.commit()
            return result
        except BaseException:
            await self.session.rollback()
            raise

    async def persist(self, plan, payloads, arguments, batch):
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
            if arguments.canvas_node_id is not None:
                await self.attach(project, arguments, generation_task_id=rows[0].id)
            return generation_task_out(rows[0])
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
                self.session,
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

    async def attach(self, project, args, **changes):
        canvas = await self.projects.canvas_row(project)
        if canvas.revision != args.expected_canvas_revision:
            raise GenerationError(
                "画布已变化，请刷新后重试", code="canvas_revision_conflict", status=409
            )
        nodes = [dict(node) for node in (canvas.nodes or [])]
        node = next((row for row in nodes if row["id"] == args.canvas_node_id), None)
        if node is None:
            raise GenerationError("画布节点不存在", code="canvas_node_not_found", status=404)
        if node["kind"] != args.kind:
            raise GenerationError("画布节点类型与生成任务不匹配", code="canvas_kind_mismatch")
        node.update(changes)
        canvas.nodes = nodes
        canvas.revision += 1
        canvas.updated_at = utc_now()
        return canvas

    async def abort(self, identity):
        async with self.sessions(info={"owner_user_id": self.owner}) as db:
            await db.execute(
                update(VisualGenerationDecision)
                .where(
                    VisualGenerationDecision.id == identity,
                    VisualGenerationDecision.state == "preparing",
                )
                .values(state="abort", updated_at=utc_now())
            )
            await db.commit()
