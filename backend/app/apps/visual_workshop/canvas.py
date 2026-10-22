from __future__ import annotations

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.visual_workshop.acceptance.access import AcceptanceError, require_passed, required_for
from app.apps.visual_workshop.models import (
    VisualCanvasDocument,
    VisualGenerationTask,
    VisualWorkshopProject,
)
from app.apps.visual_workshop.outputs.history import register_output
from app.apps.visual_workshop.outputs.models import VisualNodeOutput
from app.apps.visual_workshop.prompt_versions import preserve_legacy_prompt_versions
from app.apps.visual_workshop.schemas.workshop import (
    VisualCanvasDocumentOut,
    VisualCanvasDocumentPutIn,
    VisualCanvasNode,
    default_material_categories,
)
from app.capabilities.asset_store.models import (
    VisualAsset,
    VisualProjectAssetReference,
)
from app.runtime.ids import new_id
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
        categories=row.categories or default_material_categories(),
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
                expected.extend(
                    (asset_id, "image") for asset_id in node.generation_draft.reference_asset_ids
                )
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
            if node.get("kind") == "image":
                existing_asset_ids.update(draft.get("reference_asset_ids") or [])
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
        preserve_legacy_prompt_versions(body.nodes, row.nodes or [])
        await self._validate_assets(project_id, body.nodes, row.nodes or [])
        await self._validate_tasks(project_id, body.nodes)
        old = {node["id"]: node for node in row.nodes or []}
        removed = set(old) - {node.id for node in body.nodes}
        if any(
            edge.get("source_node_id") in removed and edge.get("target_node_id") not in removed
            for edge in row.edges or []
        ):
            raise VisualCanvasError(
                "请先解除下游输入引用，再删除节点", code="node_in_use", status=409
            )
        for edge in body.edges:
            if edge.binding == "fixed":
                output = await self.session.get(VisualNodeOutput, edge.output_id)
                if (
                    output is None
                    or output.project_id != project_id
                    or output.node_id != edge.source_node_id
                ):
                    raise VisualCanvasError(
                        "输入版本不属于上游节点", code="invalid_output_reference"
                    )
        categories = (
            [category.model_dump(mode="json") for category in body.categories]
            if body.categories is not None
            else row.categories
        )
        known_categories = {
            item["id"]: item
            for item in (
                categories
                or [category.model_dump(mode="json") for category in default_material_categories()]
            )
        }
        for node in body.nodes:
            if node.category_id and node.category_id not in known_categories:
                raise VisualCanvasError("节点分类不存在")
            if node.group and (
                not node.category_id
                or node.group not in known_categories[node.category_id]["groups"]
            ):
                raise VisualCanvasError("节点分组不存在")
            if node.id in old and node.kind != old[node.id]["kind"]:
                raise VisualCanvasError("已有节点不能改变媒体类型")
        now = utc_now()
        result = await self.session.execute(
            update(VisualCanvasDocument)
            .where(
                VisualCanvasDocument.project_id == project_id,
                VisualCanvasDocument.revision == body.expected_revision,
            )
            .values(
                edges=[edge.model_dump(mode="json") for edge in body.edges],
                categories=categories,
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
        nodes = [node.model_dump(mode="json") for node in body.nodes]
        for node, incoming in zip(nodes, body.nodes, strict=True):
            previous = old.get(node["id"], {})
            if "approved" not in incoming.model_fields_set:
                node["approved"] = previous.get("approved", False)
            if node["kind"] == "text" and node.get("text") != previous.get("text"):
                node["approved"] = False
            # Output selection is server-owned. Canvas saves cannot forge version
            # identifiers or replace a chosen history item through a stale patch.
            node["output_sequence"] = previous.get("output_sequence", 0)
            node["final_output_id"] = previous.get("final_output_id")
            node["final_version"] = previous.get("final_version")
            if (
                node["kind"] != "text"
                and node.get("asset_id")
                and node.get("asset_id") != previous.get("asset_id")
            ):
                await register_output(
                    self.session,
                    project_id,
                    node,
                    source="uploaded",
                    source_key=new_id(),
                    asset_id=node["asset_id"],
                )
            elif (
                node["kind"] != "text"
                and not node.get("asset_id")
                and previous.get("final_output_id")
            ):
                node["asset_id"] = previous.get("asset_id")
        for node in nodes:
            if await required_for(self.session, project_id, node["id"]):
                # Legacy canvas writes may register candidates, but never replace
                # adopted content or forge approval through another API surface.
                previous = old.get(node["id"], {})
                if node["kind"] != "text":
                    node["asset_id"] = previous.get("asset_id")
                if node.get("approved"):
                    try:
                        await require_passed(
                            self.session, project_id, node["id"], node.get("final_output_id")
                        )
                    except AcceptanceError as exc:
                        raise VisualCanvasError(
                            str(exc), code=exc.code, status=exc.status
                        ) from None
        await self.session.execute(
            update(VisualCanvasDocument)
            .where(VisualCanvasDocument.project_id == project_id)
            .values(nodes=nodes)
        )
        if removed:
            from app.apps.visual_workshop.acceptance.models import AcceptanceRun

            if await self.session.scalar(
                select(AcceptanceRun.id).where(
                    AcceptanceRun.project_id == project_id, AcceptanceRun.node_id.in_(removed)
                )
            ):
                raise VisualCanvasError(
                    "节点被验收记录引用，不能直接删除", code="acceptance_in_use", status=409
                )
            from sqlalchemy import delete

            await self.session.execute(
                delete(VisualNodeOutput).where(
                    VisualNodeOutput.project_id == project_id, VisualNodeOutput.node_id.in_(removed)
                )
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
