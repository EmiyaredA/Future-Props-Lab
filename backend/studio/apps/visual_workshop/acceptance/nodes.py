"""Node selection, provenance-fenced submission and project result aggregation."""

from copy import deepcopy

from sqlalchemy import func, select, update

from app.runtime.config import get_settings
from studio.apps.visual_workshop.acceptance.catalog import (
    connection_signature,
    fixed_model,
    scheme_status,
)
from studio.apps.visual_workshop.acceptance.context import fingerprint, resolve_context
from studio.apps.visual_workshop.acceptance.models import (
    AcceptanceAssetReference,
    AcceptanceRun,
    AcceptanceStandardVersion,
)
from studio.apps.visual_workshop.acceptance.node_records import NodeAcceptanceRecords
from studio.apps.visual_workshop.acceptance.project_access import AcceptanceError, project
from studio.apps.visual_workshop.acceptance.runs import Runs, run_out
from studio.apps.visual_workshop.acceptance.schemes import SCHEMES
from studio.apps.visual_workshop.storage.models import VisualCanvasDocument
from studio.runtime.ids import new_id
from studio.runtime.revisions import RevisionConflictError


class NodeAcceptance(NodeAcceptanceRecords):
    def __init__(self, session, owner_user_id, user_id):
        super().__init__(
            session,
            owner_user_id,
            user_id,
            resolve_context=resolve_context,
            scheme_status=scheme_status,
        )

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
