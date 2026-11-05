"""Shared owner-side reads and scheme selection for Visual acceptance nodes."""

from sqlalchemy import select, text

from studio.apps.visual_workshop.acceptance.models import AcceptanceRun, NodeAcceptanceBinding
from studio.apps.visual_workshop.acceptance.node_schemas import (
    AcceptanceSummaryItem,
    AcceptanceSummaryOut,
    NodeAcceptanceOut,
)
from studio.apps.visual_workshop.acceptance.project_access import AcceptanceError, project
from studio.apps.visual_workshop.acceptance.record_revisions import cas
from studio.apps.visual_workshop.acceptance.runs import run_out
from studio.apps.visual_workshop.acceptance.schemes import SCHEMES
from studio.apps.visual_workshop.outputs.models import VisualNodeOutput
from studio.apps.visual_workshop.storage.models import VisualCanvasDocument
from studio.runtime.ids import new_id


class NodeAcceptanceRecords:
    def __init__(self, session, owner_user_id, user_id, *, resolve_context, scheme_status):
        self.session, self.owner_user_id, self.user_id = session, owner_user_id, user_id
        self.resolve_context, self.scheme_status = resolve_context, scheme_status

    async def binding(self, project_id, node_id):
        return await self.session.scalar(
            select(NodeAcceptanceBinding)
            .where(
                NodeAcceptanceBinding.owner_user_id == self.owner_user_id,
                NodeAcceptanceBinding.project_id == project_id,
                NodeAcceptanceBinding.node_id == node_id,
            )
            .execution_options(populate_existing=True)
        )

    async def get(self, project_id, node_id, output_id=None, *, check_scheme=True):
        binding = await self.binding(project_id, node_id)
        scheme = binding.scheme_id if binding else None
        canvas, node, output, inputs, specs, issues, snapshot = await self.resolve_context(
            self.session, self.owner_user_id, project_id, node_id, scheme, output_id
        )
        if not scheme:
            issues.insert(0, "请选择已配置的验收方案")
        elif scheme in SCHEMES and check_scheme:
            status = await self.scheme_status(
                self.session, self.owner_user_id, self.user_id, scheme, check_cli=False
            )
            if not status.available:
                issues.append(status.message)
        elif scheme not in SCHEMES:
            issues.append("此方案已不可用，请选择当前内置方案")
        latest = await self.session.scalar(
            select(AcceptanceRun)
            .where(
                AcceptanceRun.project_id == project_id,
                AcceptanceRun.owner_user_id == self.owner_user_id,
                AcceptanceRun.node_id == node_id,
                AcceptanceRun.output_id == output.id if output else False,
            )
            .order_by(AcceptanceRun.created_at.desc())
            .limit(1)
        )
        return NodeAcceptanceOut(
            node_id=node_id,
            revision=binding.revision if binding else 0,
            scheme_id=scheme if scheme in SCHEMES else None,
            output_id=output.id if output else None,
            output_version=output.version if output else None,
            canvas_revision=canvas.revision,
            context_fingerprint=snapshot["context_fingerprint"],
            input_source=snapshot["input_source"],
            prompt=snapshot["prompt"],
            specifications=specs,
            inputs=inputs,
            issues=issues,
            current_run=run_out(latest) if latest else None,
            result_is_current=bool(
                latest
                and latest.decision != "historical"
                and latest.snapshot.get("context_fingerprint") == snapshot["context_fingerprint"]
            ),
        )

    async def select(self, project_id, node_id, body):
        _, node, *_ = await self.resolve_context(
            self.session, self.owner_user_id, project_id, node_id, body.scheme_id
        )
        if node["kind"] != "video":
            raise AcceptanceError("动作迁移模板仅适用于视频节点")
        await self.session.rollback()
        await self.session.execute(text("BEGIN IMMEDIATE"))
        current = await self.session.get(VisualCanvasDocument, project_id)
        current_node = (
            next((item for item in current.nodes if item["id"] == node_id), None)
            if current is not None
            else None
        )
        if current_node is None:
            raise AcceptanceError("节点不存在", "not_found", 404)
        if current_node["kind"] != "video":
            raise AcceptanceError("动作迁移模板仅适用于视频节点")
        binding = await self.binding(project_id, node_id)
        if binding is None:
            binding = NodeAcceptanceBinding(
                id=new_id(),
                owner_user_id=self.owner_user_id,
                project_id=project_id,
                node_id=node_id,
                scheme_id=None,
                revision=0,
            )
            self.session.add(binding)
            await self.session.flush()
        await cas(
            self.session, binding, body.expected_revision, lambda: self.get(project_id, node_id)
        )
        binding.scheme_id = body.scheme_id
        await self.session.commit()
        return await self.get(project_id, node_id)

    async def summary(self, project_id):
        await project(self.session, self.owner_user_id, project_id)
        canvas = await self.session.get(VisualCanvasDocument, project_id)
        if not canvas:
            return AcceptanceSummaryOut(items=[])
        rows = list(
            await self.session.scalars(
                select(VisualNodeOutput)
                .where(VisualNodeOutput.project_id == project_id)
                .order_by(VisualNodeOutput.version.desc())
            )
        )
        newest = {}
        for row in rows:
            newest.setdefault(row.node_id, row)
        bindings = {
            row.node_id: row
            for row in await self.session.scalars(
                select(NodeAcceptanceBinding).where(
                    NodeAcceptanceBinding.project_id == project_id,
                    NodeAcceptanceBinding.owner_user_id == self.owner_user_id,
                )
            )
        }
        records = list(
            await self.session.scalars(
                select(AcceptanceRun)
                .where(
                    AcceptanceRun.project_id == project_id,
                    AcceptanceRun.owner_user_id == self.owner_user_id,
                )
                .order_by(AcceptanceRun.created_at.desc())
            )
        )
        latest = {}
        for run in records:
            latest.setdefault(run.output_id, run)
        items = []
        for node in canvas.nodes:
            if (
                node["kind"] != "video"
                and node["id"] not in bindings
                and not any(r.node_id == node["id"] for r in records)
            ):
                continue
            output = newest.get(node["id"])
            binding = bindings.get(node["id"])
            run = latest.get(output.id) if output else None
            state = (
                "no_output"
                if output is None
                else "unconfigured"
                if not binding or not binding.scheme_id
                else "uninspected"
            )
            if run:
                state = run.status if run.status != "completed" else run.decision
                if run.scheme_id == "legacy" or run.decision == "historical":
                    state = "historical"
                elif binding and run.scheme_id != binding.scheme_id:
                    state = "stale"
                elif binding:
                    context = await self.get(project_id, node["id"], output.id, check_scheme=False)
                    if not context.result_is_current:
                        state = "stale"
            failed = (
                next((item for item in run.results if item["verdict"] == "failed"), None)
                if run
                else None
            )
            issue = ""
            if failed:
                issue = next(
                    (
                        item.get("reason", "")
                        for item in reversed(run.decisions)
                        if item.get("criterion_id") == failed["criterion_id"] and item.get("reason")
                    ),
                    failed["explanation"],
                )
            items.append(
                AcceptanceSummaryItem(
                    node_id=node["id"],
                    title=node["title"],
                    kind=node["kind"],
                    scheme_id=binding.scheme_id if binding else None,
                    output_id=output.id if output else None,
                    output_version=output.version if output else None,
                    output_asset_id=output.asset_id if output else None,
                    final_version=node.get("final_version"),
                    state=state,
                    issue=issue,
                    run=run_out(run) if run else None,
                )
            )
        return AcceptanceSummaryOut(items=items)
