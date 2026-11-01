"""Node selection, provenance-fenced submission and project result aggregation."""

from copy import deepcopy

from sqlalchemy import func, select, update
from sqlalchemy.dialects.sqlite import insert

from app.apps.visual_workshop.models import VisualCanvasDocument
from app.apps.visual_workshop.outputs.models import VisualNodeOutput
from app.runtime.config import get_settings
from app.runtime.ids import new_id
from app.runtime.revisions import RevisionConflictError

from .access import AcceptanceError, cas, project
from .catalog import SCHEMES, connection_signature, fixed_model, scheme_status
from .context import fingerprint, resolve_context
from .models import (
    AcceptanceAssetReference,
    AcceptanceRun,
    AcceptanceStandardVersion,
    NodeAcceptanceBinding,
)
from .node_schemas import AcceptanceSummaryItem, AcceptanceSummaryOut, NodeAcceptanceOut
from .runs import Runs, run_out


class NodeAcceptance:
    def __init__(self, session, owner_user_id, user_id):
        self.session, self.owner_user_id, self.user_id = session, owner_user_id, user_id

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

    async def get(self, project_id, node_id, output_id=None):
        binding = await self.binding(project_id, node_id)
        scheme = binding.scheme_id if binding else None
        canvas, node, output, inputs, specs, issues, snapshot = await resolve_context(
            self.session, self.owner_user_id, project_id, node_id, scheme, output_id
        )
        if not scheme:
            issues.insert(0, "请选择已配置的验收方案")
        elif scheme in SCHEMES:
            status = await scheme_status(
                self.session, self.owner_user_id, self.user_id, scheme, check_cli=False
            )
            if not status.available:
                issues.append(status.message)
        else:
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
        _, node, *_ = await resolve_context(
            self.session, self.owner_user_id, project_id, node_id, body.scheme_id
        )
        if node["kind"] != "video":
            raise AcceptanceError("动作迁移模板仅适用于视频节点")
        await self.session.execute(
            insert(NodeAcceptanceBinding)
            .values(
                id=new_id(),
                owner_user_id=self.owner_user_id,
                project_id=project_id,
                node_id=node_id,
                scheme_id=None,
                revision=0,
            )
            .on_conflict_do_nothing(index_elements=["project_id", "node_id"])
        )
        binding = await self.binding(project_id, node_id)
        await cas(
            self.session, binding, body.expected_revision, lambda: self.get(project_id, node_id)
        )
        binding.scheme_id = body.scheme_id
        await self.session.commit()
        return await self.get(project_id, node_id)

    async def start(self, project_id, node_id, body, admission=None):
        await project(self.session, self.owner_user_id, project_id)
        request_hash = fingerprint({"node_id": node_id, **body.model_dump()})
        prior = await self.session.scalar(
            select(AcceptanceRun).where(
                AcceptanceRun.project_id == project_id,
                AcceptanceRun.owner_user_id == self.owner_user_id,
                AcceptanceRun.request_id == body.request_id,
            )
        )
        if prior:
            if prior.fingerprint != request_hash:
                raise AcceptanceError("请求标识已用于其他验收", "request_conflict", 409)
            return run_out(prior)
        binding = await self.binding(project_id, node_id)
        if not binding or binding.scheme_id not in SCHEMES:
            raise AcceptanceError("请先选择验收方案")
        status = await scheme_status(
            self.session, self.owner_user_id, self.user_id, binding.scheme_id
        )
        if not status.available:
            raise AcceptanceError(status.message, "executor_unavailable", 409)
        # SQLite writer fence: re-read canvas and binding after waiting for any competing write.
        await self.session.execute(
            update(VisualCanvasDocument)
            .where(VisualCanvasDocument.project_id == project_id)
            .values(revision=VisualCanvasDocument.revision)
        )
        prior = await self.session.scalar(
            select(AcceptanceRun).where(
                AcceptanceRun.project_id == project_id,
                AcceptanceRun.owner_user_id == self.owner_user_id,
                AcceptanceRun.request_id == body.request_id,
            )
        )
        if prior:
            if prior.fingerprint != request_hash:
                raise AcceptanceError("请求标识已用于其他验收", "request_conflict", 409)
            return run_out(prior)
        canvas = await self.session.get(VisualCanvasDocument, project_id, populate_existing=True)
        binding = await self.binding(project_id, node_id)
        if binding.revision != body.expected_revision:
            current = await self.get(project_id, node_id, body.output_id)
            raise RevisionConflictError(
                body.expected_revision, binding.revision, current.model_dump(mode="json")
            )
        if canvas.revision != body.expected_canvas_revision:
            raise AcceptanceError("节点资料已变化，请重新读取后验收", "context_changed", 409)
        canvas, node, output, inputs, specs, issues, snapshot = await resolve_context(
            self.session, self.owner_user_id, project_id, node_id, binding.scheme_id, body.output_id
        )
        if snapshot["context_fingerprint"] != body.context_fingerprint:
            raise AcceptanceError("验收依据已变化，请重新读取后验收", "context_changed", 409)
        if issues:
            raise AcceptanceError("；".join(issues), "inputs_not_ready")
        if body.previous_run_id:
            previous = await Runs(self.session, self.owner_user_id).row(
                project_id, body.previous_run_id
            )
            if previous.node_id != node_id or previous.output_id == output.id:
                raise AcceptanceError("复验应选择同一节点的另一个输出版本")
        pair = (
            await fixed_model(self.session, self.owner_user_id, get_settings())
            if status.kind == "model_api"
            else None
        )
        if status.kind == "model_api" and pair is None:
            raise AcceptanceError("固定模型已不可用", "executor_unavailable", 409)
        snapshot["executor"] = {
            "scheme_id": binding.scheme_id,
            "user_id": self.user_id,
            "connection_label": status.connection_label,
            "model_id": pair[0].id if pair else None,
            "connection_signature": connection_signature(binding.scheme_id, get_settings(), pair),
        }
        # Freeze this run definition without publishing a project-wide active standard.
        number = (
            await self.session.scalar(
                select(func.max(AcceptanceStandardVersion.version)).where(
                    AcceptanceStandardVersion.project_id == project_id
                )
            )
        ) or 0
        definition = AcceptanceStandardVersion(
            id=new_id(),
            owner_user_id=self.owner_user_id,
            project_id=project_id,
            version=number + 1,
            document={
                "title": "动作迁移",
                "node_ids": [node_id],
                "criteria": deepcopy(snapshot["criteria"]),
            },
        )
        self.session.add(definition)
        await self.session.flush()
        run = AcceptanceRun(
            id=new_id(),
            owner_user_id=self.owner_user_id,
            project_id=project_id,
            node_id=node_id,
            output_id=output.id,
            standard_id=definition.id,
            previous_run_id=body.previous_run_id,
            request_id=body.request_id,
            fingerprint=request_hash,
            scheme_id=binding.scheme_id,
            model_id=pair[0].id if pair else None,
            snapshot=snapshot,
            status="queued",
            decision="pending",
            execution_result={},
            results=[],
            evidence=[],
            decisions=[],
        )
        self.session.add(run)
        for identity in {item.asset_id for item in inputs}:
            self.session.add(
                AcceptanceAssetReference(owner_id=run.id, project_id=project_id, asset_id=identity)
            )
        await self.session.flush()
        if admission:
            await admission([run.id])
        await self.session.commit()
        return run_out(run)

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
                    context = await self.get(project_id, node["id"], output.id)
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
