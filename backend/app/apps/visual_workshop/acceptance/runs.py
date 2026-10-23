import hashlib
import json

from sqlalchemy import select, update

from app.apps.visual_workshop.acceptance.access import AcceptanceError, asset, cas, project
from app.apps.visual_workshop.acceptance.models import (
    AcceptanceAssetReference,
    AcceptanceRun,
    AcceptanceStandardVersion,
)
from app.apps.visual_workshop.acceptance.schemas import (
    AcceptanceDocument,
    AcceptanceRunListOut,
    AcceptanceRunOut,
)
from app.apps.visual_workshop.acceptance.standards import Standards
from app.apps.visual_workshop.models import VisualCanvasDocument
from app.apps.visual_workshop.outputs.models import VisualNodeOutput
from app.llm.models import ModelEntry, ModelProvider
from app.llm.providers.chat_completions import TEXT_PROVIDER_KINDS
from app.runtime.ids import new_id
from app.runtime.time import iso_utc


def run_out(row):
    return AcceptanceRunOut(
        id=row.id,
        node_id=row.node_id,
        output_id=row.output_id,
        previous_run_id=row.previous_run_id,
        standard_version=row.snapshot["standard_version"],
        model_id=row.model_id,
        status=row.status,
        decision=row.decision,
        snapshot=row.snapshot,
        results=row.results,
        evidence=row.evidence,
        decisions=row.decisions,
        error_message=row.error_message,
        revision=row.revision,
        created_at=iso_utc(row.created_at),
    )


async def review_models(session, workspace_id):
    rows = (
        await session.execute(
            select(ModelEntry, ModelProvider)
            .join(ModelProvider, ModelProvider.id == ModelEntry.provider_id)
            .where(
                ModelEntry.workspace_id == workspace_id,
                ModelProvider.workspace_id == workspace_id,
                ModelEntry.enabled.is_(True),
                ModelProvider.enabled.is_(True),
                ModelProvider.kind.in_(TEXT_PROVIDER_KINDS),
            )
        )
    ).all()
    return [
        (model, provider)
        for model, provider in rows
        if {"chat", "vision"} <= set(model.capabilities or [])
        and bool(provider.api_key_ciphertext or provider.base_url)
    ]


class Runs:
    def __init__(self, session, workspace_id):
        self.session, self.workspace_id = session, workspace_id

    async def row(self, project_id, run_id):
        await project(self.session, self.workspace_id, project_id)
        row = await self.session.scalar(
            select(AcceptanceRun).where(
                AcceptanceRun.id == run_id,
                AcceptanceRun.project_id == project_id,
                AcceptanceRun.workspace_id == self.workspace_id,
            )
        )
        if row is None:
            raise AcceptanceError("验收记录不存在", "not_found", 404)
        return row

    async def get(self, project_id, run_id):
        return run_out(await self.row(project_id, run_id))

    async def list(self, project_id, node_id=None, page=1):
        await project(self.session, self.workspace_id, project_id)
        query = select(AcceptanceRun).where(
            AcceptanceRun.project_id == project_id, AcceptanceRun.workspace_id == self.workspace_id
        )
        if node_id:
            query = query.where(AcceptanceRun.node_id == node_id)
        rows = await self.session.scalars(
            query.order_by(AcceptanceRun.created_at.desc()).offset((page - 1) * 50).limit(50)
        )
        return AcceptanceRunListOut(items=[run_out(row) for row in rows])

    async def replay(self, project_id, body):
        await project(self.session, self.workspace_id, project_id)
        fingerprint = hashlib.sha256(
            json.dumps(body.model_dump(mode="json"), sort_keys=True).encode()
        ).hexdigest()
        prior = list(
            await self.session.scalars(
                select(AcceptanceRun).where(
                    AcceptanceRun.project_id == project_id,
                    AcceptanceRun.workspace_id == self.workspace_id,
                    AcceptanceRun.request_id == body.request_id,
                )
            )
        )
        if not prior:
            return None
        if any(row.fingerprint != fingerprint for row in prior) or set(body.output_ids) != {
            row.output_id for row in prior
        }:
            raise AcceptanceError("请求标识已用于其他验收", "request_conflict", 409)
        return AcceptanceRunListOut(items=[run_out(row) for row in prior])

    async def create(self, project_id, body, admission=None):
        await project(self.session, self.workspace_id, project_id)
        await self.session.execute(
            update(VisualCanvasDocument)
            .where(VisualCanvasDocument.project_id == project_id)
            .values(revision=VisualCanvasDocument.revision)
        )
        fingerprint = hashlib.sha256(
            json.dumps(body.model_dump(mode="json"), sort_keys=True).encode()
        ).hexdigest()
        prior = list(
            await self.session.scalars(
                select(AcceptanceRun).where(
                    AcceptanceRun.project_id == project_id,
                    AcceptanceRun.request_id == body.request_id,
                )
            )
        )
        if prior:
            if any(row.fingerprint != fingerprint for row in prior) or set(body.output_ids) != {
                row.output_id for row in prior
            }:
                raise AcceptanceError("请求标识已用于其他验收", "request_conflict", 409)
            return AcceptanceRunListOut(items=[run_out(row) for row in prior])
        standard = await Standards(self.session, self.workspace_id).get(project_id)
        if standard.published_version != body.expected_standard_version:
            raise AcceptanceError("标准已变化，请重新选择", "standard_changed", 409)
        version = await self.session.scalar(
            select(AcceptanceStandardVersion).where(
                AcceptanceStandardVersion.project_id == project_id,
                AcceptanceStandardVersion.version == standard.published_version,
            )
        )
        if version is None:
            raise AcceptanceError("请先发布项目标准")
        document = AcceptanceDocument.model_validate(version.document)
        await Standards(self.session, self.workspace_id).validate(project_id, document)
        canvas = await self.session.get(VisualCanvasDocument, project_id)
        nodes = {node["id"]: node for node in canvas.nodes}
        previous = (
            await self.row(project_id, body.previous_run_id) if body.previous_run_id else None
        )
        rows = []
        if len(set(body.output_ids)) != len(body.output_ids):
            raise AcceptanceError("输出版本不能重复")
        for identity in body.output_ids:
            output = await self.session.scalar(
                select(VisualNodeOutput).where(
                    VisualNodeOutput.id == identity, VisualNodeOutput.project_id == project_id
                )
            )
            if not output or output.node_id not in nodes:
                raise AcceptanceError("输出不存在", "not_found", 404)
            if document.node_ids and output.node_id not in document.node_ids:
                raise AcceptanceError("输出节点不在标准应用范围")
            if previous and (
                previous.node_id != output.node_id
                or previous.output_id == identity
                or len(body.output_ids) != 1
            ):
                raise AcceptanceError("复验应选择同一节点的另一个输出版本")
            criteria = [
                item.model_dump(mode="json")
                for item in document.criteria
                if output.kind in item.kinds
            ]
            if not criteria:
                raise AcceptanceError("没有适用于此媒体的验收项")
            if any(item["method"] == "ai" for item in criteria):
                models = await review_models(self.session, self.workspace_id)
                if not body.model_id or body.model_id not in {model.id for model, _ in models}:
                    raise AcceptanceError("请选择当前可用的视觉模型", "model_unavailable", 409)
            source = None
            if output.asset_id:
                source = await asset(self.session, self.workspace_id, project_id, output.asset_id)
            row = AcceptanceRun(
                id=new_id(),
                workspace_id=self.workspace_id,
                project_id=project_id,
                node_id=output.node_id,
                output_id=identity,
                standard_id=version.id,
                previous_run_id=body.previous_run_id,
                request_id=body.request_id,
                fingerprint=fingerprint,
                model_id=body.model_id,
                status="queued",
                decision="pending",
                snapshot={
                    "standard_version": version.version,
                    "standard_title": document.title,
                    "criteria": criteria,
                    "output": {
                        "id": identity,
                        "kind": output.kind,
                        "version": output.version,
                        "asset_id": output.asset_id,
                        "text": output.text,
                        "title": nodes[output.node_id]["title"],
                    },
                    "prompt": (nodes[output.node_id].get("generation_draft") or {}).get(
                        "prompt", ""
                    ),
                    "coverage": "视频仅进行抽帧辅助检查，未覆盖的连续动作需要人工播放确认。"
                    if output.kind == "video"
                    else "静态图片或人工审阅。",
                    "source_bytes": source.byte_size if source else None,
                },
                results=[],
                evidence=[],
                decisions=[],
            )
            self.session.add(row)
            await self.session.flush()
            rows.append(row)
            for asset_id in {
                value for item in criteria for value in item["reference_asset_ids"]
            } | ({output.asset_id} if output.asset_id else set()):
                self.session.add(
                    AcceptanceAssetReference(
                        owner_id=row.id, project_id=project_id, asset_id=asset_id
                    )
                )
        if admission:
            await admission([row.id for row in rows])
        await self.session.commit()
        return AcceptanceRunListOut(items=[run_out(row) for row in rows])

    async def cancel(self, project_id, run_id, expected):

        row = await self.row(project_id, run_id)
        await cas(self.session, row, expected, lambda: self.get(project_id, run_id))
        if row.status not in {"queued", "processing"}:
            raise AcceptanceError("仅可取消执行中的检查", "invalid_state", 409)
        row.status = "cancelled"
        await self.session.commit()
        return run_out(row)
