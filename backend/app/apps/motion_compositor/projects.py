from __future__ import annotations

from copy import deepcopy

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.motion_compositor.models import MotionDocument, MotionOperationBatch, MotionProject
from app.apps.motion_compositor.schemas import (
    DocumentOut,
    OperationBatchIn,
    ProjectCreateIn,
    ProjectListOut,
    ProjectOut,
    ProjectPatchIn,
)
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.project_transactions import (
    creating_project_layout,
    deleting_project_layout,
)
from app.capabilities.asset_store.storage import AssetStorage
from app.capabilities.media_rendering.motion_document import MotionComposition
from app.runtime.config import get_settings
from app.runtime.project_records import (
    delete_revisioned_project,
    load_owned_project,
    patch_revisioned_project,
)
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import iso_utc, utc_now


class MotionNotFound(Exception):
    pass


class MotionInvalid(Exception):
    pass


def project_out(row: MotionProject) -> ProjectOut:
    return ProjectOut(
        id=row.id,
        title=row.title,
        revision=row.revision,
        createdAt=iso_utc(row.created_at),
        updatedAt=iso_utc(row.updated_at),
    )


def initial_document(body: ProjectCreateIn) -> MotionComposition:
    size = {"16:9": (1920, 1080), "9:16": (1080, 1920), "1:1": (1080, 1080)}[body.aspect]
    width, height = size
    duration = 6 * body.fps
    layers = []
    if body.starter == "comic-entry":
        layers = [
            {
                "id": "paper",
                "name": "底色",
                "kind": "shape",
                "shape": "rect",
                "width": width,
                "height": height,
                "fill": "#fff8ec",
                "transform": {"x": width / 2, "y": height / 2},
                "endFrame": duration,
            },
            {
                "id": "red-panel",
                "name": "红色斜切",
                "kind": "shape",
                "shape": "rect",
                "width": round(width * 0.7),
                "height": round(height * 1.4),
                "fill": "#e73548",
                "transform": {"x": width * 0.76, "y": height * 0.5, "rotation": -18},
                "keyframes": [
                    {"id": "red-start", "frame": 0, "property": "x", "value": width * 1.3},
                    {
                        "id": "red-end",
                        "frame": round(body.fps * 0.7),
                        "property": "x",
                        "value": width * 0.76,
                        "interpolation": "ease-out",
                    },
                ],
                "endFrame": duration,
            },
            {
                "id": "speed-lines",
                "name": "速度线",
                "kind": "shape",
                "shape": "speedLines",
                "width": round(width * 0.8),
                "height": round(height * 0.8),
                "fill": "#111318",
                "transform": {"x": width * 0.47, "y": height * 0.5},
                "endFrame": duration,
            },
            {
                "id": "silhouette-coat",
                "name": "人物剪影 · 风衣",
                "kind": "shape",
                "shape": "triangle",
                "width": round(width * 0.23),
                "height": round(height * 0.64),
                "fill": "#111318",
                "transform": {"x": width * 0.78, "y": height * 0.69, "rotation": -8},
                "keyframes": [
                    {"id": "coat-start", "frame": 0, "property": "x", "value": width * 1.15},
                    {
                        "id": "coat-end",
                        "frame": round(body.fps * 0.65),
                        "property": "x",
                        "value": width * 0.78,
                        "interpolation": "ease-out",
                    },
                ],
                "endFrame": duration,
            },
            {
                "id": "silhouette-head",
                "name": "人物剪影 · 头像",
                "kind": "shape",
                "shape": "ellipse",
                "width": round(width * 0.13),
                "height": round(height * 0.24),
                "fill": "#111318",
                "transform": {"x": width * 0.78, "y": height * 0.28},
                "keyframes": [
                    {"id": "head-start", "frame": 0, "property": "x", "value": width * 1.15},
                    {
                        "id": "head-end",
                        "frame": round(body.fps * 0.65),
                        "property": "x",
                        "value": width * 0.78,
                        "interpolation": "ease-out",
                    },
                ],
                "endFrame": duration,
            },
            {
                "id": "title",
                "name": "标题",
                "kind": "text",
                "text": "怪盗来袭",
                "fontSize": max(80, round(width * 0.095)),
                "width": round(width * 0.62),
                "height": round(height * 0.3),
                "fill": "#111318",
                "transform": {"x": width * 0.42, "y": height * 0.55, "rotation": -7},
                "keyframes": [
                    {"id": "title-0", "frame": 0, "property": "x", "value": -width * 0.3},
                    {
                        "id": "title-1",
                        "frame": round(body.fps * 0.8),
                        "property": "x",
                        "value": width * 0.42,
                        "interpolation": "ease-out",
                    },
                ],
                "endFrame": duration,
            },
        ]
    return MotionComposition.model_validate(
        {
            "schemaVersion": 1,
            "settings": {
                "width": width,
                "height": height,
                "fps": body.fps,
                "durationFrames": duration,
            },
            "layers": layers,
        }
    )


class MotionProjects:
    def __init__(self, session: AsyncSession, owner_user_id: str) -> None:
        self.session = session
        self.owner_user_id = owner_user_id
        self.storage = AssetStorage(get_settings())

    async def row(self, project_id: str) -> MotionProject:
        return await load_owned_project(
            self.session,
            MotionProject,
            project_id,
            self.owner_user_id,
            not_found=lambda: MotionNotFound("特效项目不存在"),
        )

    async def list(self) -> ProjectListOut:
        rows = list(
            (
                await self.session.execute(
                    select(MotionProject)
                    .where(MotionProject.owner_user_id == self.owner_user_id)
                    .order_by(MotionProject.updated_at.desc())
                )
            ).scalars()
        )
        return ProjectListOut(items=[project_out(row) for row in rows])

    async def get(self, project_id: str) -> ProjectOut:
        return project_out(await self.row(project_id))

    async def create(self, body: ProjectCreateIn) -> ProjectOut:
        row = MotionProject(owner_user_id=self.owner_user_id, title=body.title)
        self.session.add(row)
        await self.session.flush()
        async with creating_project_layout(
            self.session,
            self.storage,
            "motion-compositor",
            row.id,
            owner_user_id=self.owner_user_id,
        ):
            self.session.add(
                MotionDocument(
                    project_id=row.id,
                    document=initial_document(body).model_dump(mode="json", by_alias=True),
                )
            )
        await self.session.refresh(row)
        return project_out(row)

    async def patch(self, project_id: str, body: ProjectPatchIn) -> ProjectOut:
        await self.row(project_id)
        await patch_revisioned_project(
            self.session,
            MotionProject,
            project_id,
            self.owner_user_id,
            expected_revision=body.expected_revision,
            values={
                "title": body.title.strip(),
                "revision": body.expected_revision + 1,
                "updated_at": utc_now(),
            },
            load_current=lambda: self.get(project_id),
        )
        await self.session.commit()
        return await self.get(project_id)

    async def delete(self, project_id: str, expected_revision: int) -> None:
        await self.row(project_id)
        async with deleting_project_layout(
            self.session,
            self.storage,
            "motion-compositor",
            project_id,
            owner_user_id=self.owner_user_id,
        ):
            await delete_revisioned_project(
                self.session,
                MotionProject,
                project_id,
                self.owner_user_id,
                expected_revision=expected_revision,
                load_current=lambda: self.get(project_id),
            )

    async def document(self, project_id: str) -> DocumentOut:
        await self.row(project_id)
        row = await self.session.get(MotionDocument, project_id)
        if row is None:
            raise MotionNotFound("特效文档不存在")
        return DocumentOut(
            revision=row.revision, document=MotionComposition.model_validate(row.document)
        )

    async def _validate_assets(self, project_id: str, document: MotionComposition) -> None:
        ids = {layer.asset_id for layer in document.layers if layer.asset_id}
        if not ids:
            return
        rows = list(
            (
                await self.session.execute(
                    select(VisualAsset).where(
                        VisualAsset.id.in_(ids),
                        VisualAsset.motion_compositor_project_id == project_id,
                        VisualAsset.owner_user_id == self.owner_user_id,
                    )
                )
            ).scalars()
        )
        assets = {row.id: row for row in rows}
        if set(assets) != ids:
            raise MotionInvalid("文档引用了不属于此项目的素材")
        if any(
            assets[layer.asset_id].media_kind != layer.kind
            for layer in document.layers
            if layer.asset_id
        ):
            raise MotionInvalid("素材类型与图层类型不一致")

    async def apply(self, project_id: str, body: OperationBatchIn) -> DocumentOut:
        await self.row(project_id)
        payload = [
            operation.model_dump(mode="json", by_alias=True, exclude_none=True)
            for operation in body.operations
        ]
        existing = (
            await self.session.execute(
                select(MotionOperationBatch).where(
                    MotionOperationBatch.project_id == project_id,
                    MotionOperationBatch.request_id == body.request_id,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            if existing.base_revision != body.expected_revision or existing.operations != payload:
                raise MotionInvalid("requestId 已用于不同的编辑操作")
            return DocumentOut(
                revision=existing.result_revision,
                document=MotionComposition.model_validate(existing.result_document),
            )
        row = await self.session.get(MotionDocument, project_id)
        if row is None:
            raise MotionNotFound("特效文档不存在")
        if row.revision != body.expected_revision:
            raise RevisionConflictError(
                body.expected_revision,
                row.revision,
                {"revision": row.revision, "document": row.document},
            )
        result = deepcopy(row.document)
        for op in payload:
            kind = op["type"]
            if kind == "replaceDocument":
                if "document" not in op:
                    raise MotionInvalid("缺少文档")
                result = op["document"]
                continue
            if kind == "updateSettings":
                result["settings"].update(op.get("patch") or {})
                continue
            if kind == "addLayer":
                if "layer" not in op:
                    raise MotionInvalid("缺少图层")
                result["layers"].append(op["layer"])
                continue
            if kind == "reorderLayers":
                ids = op.get("layerIds") or []
                layers = {layer["id"]: layer for layer in result["layers"]}
                if len(ids) != len(layers) or set(ids) != set(layers):
                    raise MotionInvalid("图层顺序无效")
                result["layers"] = [layers[layer_id] for layer_id in ids]
                continue
            layer = next(
                (item for item in result["layers"] if item["id"] == op.get("layerId")), None
            )
            if layer is None:
                raise MotionInvalid("图层不存在")
            if kind == "removeLayer":
                result["layers"].remove(layer)
            elif kind == "updateLayer":
                patch = op.get("patch") or {}
                for key, value in patch.items():
                    if key in {"transform", "effects"} and isinstance(value, dict):
                        layer[key] = {**layer.get(key, {}), **value}
                    else:
                        layer[key] = value
            else:
                raise MotionInvalid("不支持的编辑操作")
        document = MotionComposition.model_validate(result)
        await self._validate_assets(project_id, document)
        serialized = document.model_dump(mode="json", by_alias=True)
        write = await self.session.execute(
            update(MotionDocument)
            .where(
                MotionDocument.project_id == project_id,
                MotionDocument.revision == body.expected_revision,
            )
            .values(document=serialized, revision=body.expected_revision + 1, updated_at=utc_now())
        )
        if write.rowcount != 1:
            await self.session.rollback()
            current = await self.document(project_id)
            raise RevisionConflictError(
                body.expected_revision,
                current.revision,
                current.model_dump(mode="json", by_alias=True),
            )
        self.session.add(
            MotionOperationBatch(
                owner_user_id=self.owner_user_id,
                project_id=project_id,
                request_id=body.request_id,
                base_revision=body.expected_revision,
                result_revision=body.expected_revision + 1,
                operations=payload,
                result_document=serialized,
            )
        )
        await self.session.execute(
            update(MotionProject).where(MotionProject.id == project_id).values(updated_at=utc_now())
        )
        await self.session.commit()
        return DocumentOut(revision=body.expected_revision + 1, document=document)
