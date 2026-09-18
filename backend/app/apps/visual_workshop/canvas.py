from __future__ import annotations

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.visual_workshop.models import (
    VisualCanvasDocument,
    VisualGenerationTask,
    VisualWorkshopProject,
)
from app.apps.visual_workshop.schemas.workshop import (
    VisualCanvasDocumentOut,
    VisualCanvasDocumentPutIn,
    VisualCanvasNode,
)
from app.capabilities.asset_store.models import (
    VisualAsset,
    VisualProjectAssetReference,
)
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import iso_utc, utc_now


class VisualCanvasError(Exception):
    def __init__(self, message: str, *, code: str = "invalid_canvas", status: int = 422) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


def canvas_out(row: VisualCanvasDocument) -> VisualCanvasDocumentOut:
    return VisualCanvasDocumentOut(
        project_id=row.project_id,
        nodes=row.nodes or [],
        edges=row.edges or [],
        revision=row.revision,
        updated_at=iso_utc(row.updated_at),
    )


class VisualCanvasDocuments:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _row(self, project_id: str) -> VisualCanvasDocument:
        project = await self.session.get(VisualWorkshopProject, project_id)
        if project is None:
            raise VisualCanvasError("项目不存在", code="not_found", status=404)
        row = await self.session.get(VisualCanvasDocument, project_id)
        if row is None:
            raise VisualCanvasError("项目画布不存在", code="canvas_not_found", status=404)
        return row

    async def get(self, project_id: str) -> VisualCanvasDocumentOut:
        return canvas_out(await self._row(project_id))

    async def _validate_assets(
        self,
        project_id: str,
        nodes: list[VisualCanvasNode],
        current_nodes: list[dict],
    ) -> None:
        expected: list[tuple[str, str]] = []
        for node in nodes:
            if node.kind != "text" and node.asset_id is not None:
                expected.append((node.asset_id, node.kind))
            if node.kind == "image" and node.generation_draft:
                if node.generation_draft.reference_asset_id:
                    expected.append((node.generation_draft.reference_asset_id, "image"))
            if node.kind == "video" and node.generation_draft:
                draft = node.generation_draft
                expected.extend(
                    (asset_id, "image")
                    for asset_id in (
                        draft.first_frame_asset_id,
                        draft.last_frame_asset_id,
                        *draft.reference_asset_ids,
                    )
                    if asset_id
                )
                expected.extend((asset_id, "audio") for asset_id in draft.audio_asset_ids)
                expected.extend((asset_id, "video") for asset_id in draft.video_asset_ids)
            if node.kind == "audio" and node.generation_draft:
                expected.extend(
                    (asset_id, "audio") for asset_id in node.generation_draft.reference_asset_ids
                )
        if not expected:
            return
        expected_ids = {asset_id for asset_id, _ in expected}
        rows = (
            (
                await self.session.execute(
                    select(VisualAsset).where(VisualAsset.id.in_(expected_ids))
                )
            )
            .scalars()
            .all()
        )
        assets = {row.id: row for row in rows}
        public_ids = [row.id for row in rows if row.project_id is None]
        references = set()
        if public_ids:
            references = set(
                (
                    await self.session.execute(
                        select(VisualProjectAssetReference.asset_id).where(
                            VisualProjectAssetReference.project_id == project_id,
                            VisualProjectAssetReference.asset_id.in_(public_ids),
                        )
                    )
                )
                .scalars()
                .all()
            )
        existing_asset_ids: set[str] = set()
        for node in current_nodes:
            if node.get("asset_id"):
                existing_asset_ids.add(node["asset_id"])
            draft = node.get("generation_draft") or {}
            if node.get("kind") == "image" and draft.get("reference_asset_id"):
                existing_asset_ids.add(draft["reference_asset_id"])
            if node.get("kind") == "video":
                existing_asset_ids.update(
                    asset_id
                    for asset_id in (
                        draft.get("first_frame_asset_id"),
                        draft.get("last_frame_asset_id"),
                        *(draft.get("reference_asset_ids") or []),
                        *(draft.get("audio_asset_ids") or []),
                        *(draft.get("video_asset_ids") or []),
                    )
                    if asset_id
                )
            if node.get("kind") == "audio":
                existing_asset_ids.update(draft.get("reference_asset_ids") or [])
        for asset_id, kind in expected:
            asset = assets.get(asset_id)
            if asset is None:
                if asset_id in existing_asset_ids:
                    continue
                raise VisualCanvasError("节点素材不存在", code="asset_not_found")
            if asset.media_kind != kind:
                raise VisualCanvasError("节点与素材类型不匹配", code="asset_kind_mismatch")
            if asset.project_id != project_id and asset.id not in references:
                if asset_id in existing_asset_ids:
                    continue
                raise VisualCanvasError("节点素材不属于当前项目", code="scope_mismatch")

    async def _validate_tasks(self, project_id: str, nodes: list[VisualCanvasNode]) -> None:
        expected = {
            node.generation_task_id: node.kind
            for node in nodes
            if node.kind in {"image", "video", "audio"} and node.generation_task_id is not None
        }
        if not expected:
            return
        rows = (
            (
                await self.session.execute(
                    select(VisualGenerationTask).where(VisualGenerationTask.id.in_(expected.keys()))
                )
            )
            .scalars()
            .all()
        )
        tasks = {row.id: row for row in rows}
        for task_id, kind in expected.items():
            task = tasks.get(task_id)
            if task is None:
                raise VisualCanvasError("节点生成任务不存在", code="task_not_found")
            if task.project_id != project_id or task.generation_kind != kind:
                raise VisualCanvasError("节点生成任务不属于当前项目", code="scope_mismatch")

    async def replace(
        self,
        project_id: str,
        body: VisualCanvasDocumentPutIn,
    ) -> VisualCanvasDocumentOut:
        row = await self._row(project_id)
        await self._validate_assets(project_id, body.nodes, row.nodes or [])
        await self._validate_tasks(project_id, body.nodes)
        now = utc_now()
        result = await self.session.execute(
            update(VisualCanvasDocument)
            .where(
                VisualCanvasDocument.project_id == project_id,
                VisualCanvasDocument.revision == body.expected_revision,
            )
            .values(
                nodes=[node.model_dump(mode="json") for node in body.nodes],
                edges=[edge.model_dump(mode="json") for edge in body.edges],
                revision=body.expected_revision + 1,
                updated_at=now,
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            current = await self.get(project_id)
            raise RevisionConflictError(
                body.expected_revision,
                current.revision,
                current.model_dump(mode="json"),
            )
        return await self.get(project_id)

    async def put(
        self,
        project_id: str,
        body: VisualCanvasDocumentPutIn,
    ) -> VisualCanvasDocumentOut:
        result = await self.replace(project_id, body)
        await self.session.commit()
        return result
