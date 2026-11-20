"""Validate and freeze the remapped Canvas, output and acceptance records."""

from datetime import datetime

from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, ValidationError
from sqlalchemy import inspect

from studio.apps.visual_workshop.acceptance.models import (
    AcceptanceAssetReference,
    AcceptanceRepairDraft,
    AcceptanceRun,
    AcceptanceStandard,
    AcceptanceStandardVersion,
    NodeAcceptanceBinding,
)
from studio.apps.visual_workshop.acceptance.snapshots import acceptance_records
from studio.apps.visual_workshop.creative_assets import (
    MODEL_MIME,
    remap_scene_models,
    scene_model_assets,
)
from studio.apps.visual_workshop.creative_snapshots import import_creative_workflow
from studio.apps.visual_workshop.outputs.models import VisualNodeOutput
from studio.apps.visual_workshop.outputs.snapshots import import_outputs
from studio.apps.visual_workshop.previs_scenes import import_scenes
from studio.apps.visual_workshop.project_values import project_out
from studio.apps.visual_workshop.schemas.workshop import (
    VisualCanvasDocumentPutIn,
    VisualProjectSnapshotImportOut,
    VisualWorkshopProjectCreateIn,
    default_material_categories,
)
from studio.apps.visual_workshop.snapshot_values import (
    canvas_asset_ids,
    copy_title,
    remap_canvas,
    validated_asset_records,
    validated_folders,
)
from studio.apps.visual_workshop.storage.models import (
    VisualAssetCard,
    VisualCanvasDocument,
    VisualPrevisScene,
    VisualScript,
    VisualWorkshopProject,
)
from studio.runtime.files.project_archives import ProjectSnapshotError
from studio.runtime.time import utc_now

OWNED_RECORDS = {
    model.__tablename__: model
    for model in (
        VisualCanvasDocument,
        VisualScript,
        VisualAssetCard,
        VisualPrevisScene,
        VisualNodeOutput,
        NodeAcceptanceBinding,
        AcceptanceStandard,
        AcceptanceStandardVersion,
        AcceptanceRun,
        AcceptanceAssetReference,
        AcceptanceRepairDraft,
    )
}


class SnapshotRow(BaseModel):
    table: str
    values: dict

    @classmethod
    def freeze(cls, row):
        state = inspect(row)
        return cls(
            table=row.__tablename__,
            values=jsonable_encoder(
                {
                    key: state.dict[key]
                    for key in state.mapper.column_attrs.keys()
                    if key in state.dict
                }
            ),
        )

    def build(self):
        model = OWNED_RECORDS[self.table]
        values = dict(self.values)
        for name in ("created_at", "updated_at"):
            if name in values:
                values[name] = datetime.fromisoformat(values[name])
        return model(**values)


class SnapshotResult(BaseModel):
    public: VisualProjectSnapshotImportOut
    phases: list[list[SnapshotRow]]

    async def write(self, session, owner):
        project = self.public.project
        session.add(
            VisualWorkshopProject(
                id=project.id,
                owner_user_id=owner,
                is_official=False,
                title=project.title,
                kind=project.kind,
                status=project.status,
                revision=project.revision,
                created_at=datetime.fromisoformat(project.created_at).replace(tzinfo=None),
                updated_at=datetime.fromisoformat(project.updated_at).replace(tzinfo=None),
            )
        )
        await session.flush()
        for phase in self.phases:
            session.add_all([row.build() for row in phase])
            await session.flush()


class SnapshotValues:
    def __init__(self, staged):
        payload = staged.project
        if payload.get("schema_version") != 1 or not isinstance(payload.get("project"), dict):
            raise ProjectSnapshotError("project.json 不是受支持的视觉工坊快照")
        self.source = payload["project"]
        try:
            self.create = VisualWorkshopProjectCreateIn.model_validate(self.source)
            self.canvas = VisualCanvasDocumentPutIn.model_validate(
                {**(payload.get("canvas") or {}), "expected_revision": 0}
            )
        except (TypeError, ValidationError) as exc:
            raise ProjectSnapshotError("视觉画布结构无效") from exc
        self.status = self.source.get("status")
        if self.status not in ("draft", "completed"):
            raise ProjectSnapshotError("视觉项目状态无效")
        declared = {item.source_id for item in staged.manifest.assets}
        self.assets = validated_asset_records(payload.get("assets"), declared)
        self.folders = validated_folders(payload.get("folders"))
        folder_ids = {row["id"] for row in self.folders}
        if any(
            row.get("folder_id") is not None and row["folder_id"] not in folder_ids
            for row in self.assets
        ):
            raise ProjectSnapshotError("视觉项目素材引用的文件夹不存在")
        self.references = payload.get("model_references")
        self.outputs = payload.get("outputs", [])
        self.scenes = import_scenes(payload)
        self.creative = payload
        self.acceptance = payload.get("acceptance")

    def build(self, owner, project_id, asset_ids, model_ids):
        try:
            return self._build(owner, project_id, asset_ids, model_ids)
        except (AttributeError, KeyError, TypeError, ValueError) as exc:
            raise ProjectSnapshotError("视觉项目快照结构或关联无效") from exc

    def _build(self, owner, project_id, asset_ids, model_ids):
        nodes, edges, warnings = remap_canvas(self.canvas, asset_ids, model_ids, self.references)
        original_nodes = [node["id"] for node in nodes]
        outputs = import_outputs(self.outputs, nodes, edges, asset_ids, project_id)
        metadata = {asset_ids[row["id"]]: row for row in self.assets}
        validate_output_media(outputs, metadata)
        creative, creative_assets, models = import_creative_workflow(
            self.creative, owner, project_id, asset_ids
        )
        if any(metadata[asset]["media_kind"] != "image" for asset in creative_assets):
            raise ProjectSnapshotError("设定卡引用的素材不是图片")
        models |= {
            asset_ids[key] for scene in self.scenes for key in scene_model_assets(scene.document)
        }
        if any(metadata[asset]["mime_type"] != MODEL_MIME for asset in models):
            raise ProjectSnapshotError("白模模型文件无效")
        node_ids = dict(zip(original_nodes, [node["id"] for node in nodes], strict=True))
        output_ids = {
            original["id"]: row.id for original, row in zip(self.outputs, outputs, strict=False)
        }
        acceptance = acceptance_records(
            self.acceptance,
            project_id,
            owner,
            node_ids,
            output_ids,
            asset_ids,
        )
        if self.acceptance and self.acceptance["required"]:
            for node in nodes:
                node["approved"] = False
        canvas = VisualCanvasDocument(
            project_id=project_id,
            nodes=nodes,
            edges=edges,
            groups=[
                {**group.model_dump(), "node_ids": [node_ids[key] for key in group.node_ids]}
                for group in self.canvas.groups or []
            ],
            categories=[
                row.model_dump(mode="json")
                for row in (self.canvas.categories or default_material_categories())
            ],
        )
        now = utc_now()
        scenes = [
            VisualPrevisScene(
                project_id=project_id,
                created_at=now,
                updated_at=now,
                document=remap_scene_models(body.document, asset_ids),
                **body.model_dump(exclude={"document"}),
            )
            for body in self.scenes
        ]
        project = VisualWorkshopProject(
            id=project_id,
            owner_user_id=owner,
            is_official=False,
            title=copy_title(self.create.title),
            kind=self.create.kind,
            status=self.status,
            revision=0,
            created_at=now,
            updated_at=now,
        )
        return (
            SnapshotResult(
                public=VisualProjectSnapshotImportOut(
                    project=project_out(project), warnings=warnings
                ),
                phases=[
                    [SnapshotRow.freeze(row) for row in phase]
                    for phase in ([canvas, *outputs, *scenes, *creative], *acceptance)
                ],
            ),
            canvas_asset_ids(nodes) | output_references(outputs) | creative_assets | models,
            acceptance_references(acceptance),
        )


def validate_output_media(outputs, metadata):
    for output in outputs:
        if output.asset_id and metadata[output.asset_id]["media_kind"] != output.kind:
            raise ProjectSnapshotError("历史版本与素材类型不匹配")
        if output.inspection_asset_id:
            info = metadata[output.inspection_asset_id]
            if info["media_kind"] != "video" or info["mime_type"] != "video/webm":
                raise ProjectSnapshotError("检查视频与素材类型不匹配")


def output_references(outputs):
    return {
        identity
        for row in outputs
        for identity in (
            row.asset_id,
            row.inspection_asset_id,
            *(item.get("asset_id") for item in row.input_snapshot),
        )
        if identity
    }


def acceptance_references(phases):
    ids = set()
    for phase in phases:
        for row in phase:
            if isinstance(row, AcceptanceStandard):
                ids.update(
                    identity
                    for criterion in row.draft["criteria"]
                    for identity in criterion["reference_asset_ids"]
                )
            elif isinstance(row, AcceptanceAssetReference):
                ids.add(row.asset_id)
            elif isinstance(row, AcceptanceRun):
                ids.update(item["source_asset_id"] for item in row.evidence)
                inputs = row.snapshot.get("inputs", {})
                ids.update(
                    item["asset_id"]
                    for item in (*inputs.get("assets", []), *inputs.get("provenance", []))
                    if item.get("asset_id")
                )
    return ids
