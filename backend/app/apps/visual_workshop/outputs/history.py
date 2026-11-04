from copy import deepcopy

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.visual_workshop.models import VisualCanvasDocument
from app.apps.visual_workshop.node_placement import automatic_node_position
from app.apps.visual_workshop.outputs.models import VisualNodeOutput
from app.apps.visual_workshop.outputs.mutations import OutputMutations
from app.apps.visual_workshop.outputs.queries import OutputError as OutputError
from app.apps.visual_workshop.outputs.queries import output_out as output_out
from app.apps.visual_workshop.outputs.recording import register_output as register_output
from app.capabilities.asset_store.models import VisualAsset, VisualProjectAssetReference
from app.runtime.ids import new_id
from app.runtime.time import utc_now


async def publish_generated_output(
    session: AsyncSession,
    project_id: str,
    node_id: str | None,
    asset_id: str,
    source_key: str,
    task_id: str | None = None,
    input_snapshot: list[dict] | None = None,
) -> str | None:
    # Acquire the SQLite write lock before reading the latest document. Never
    # replace an old snapshot when another editor has just saved it.
    await session.execute(
        update(VisualCanvasDocument)
        .where(VisualCanvasDocument.project_id == project_id)
        .values(revision=VisualCanvasDocument.revision)
    )
    canvas = await session.get(VisualCanvasDocument, project_id, populate_existing=True)
    if not canvas:
        return
    existing = await session.scalar(
        select(VisualNodeOutput).where(
            VisualNodeOutput.project_id == project_id, VisualNodeOutput.source_key == source_key
        )
    )
    if existing:
        return existing.node_id
    nodes = deepcopy(canvas.nodes or [])
    if node_id is None:
        asset = await session.get(VisualAsset, asset_id)
        if not asset:
            return None
        node_id = new_id()
        node = {
            "id": node_id,
            "kind": asset.media_kind,
            "title": asset.display_name,
            "position": automatic_node_position(nodes, asset.media_kind),
            "asset_id": None,
            "generation_task_id": task_id,
        }
        nodes.append(node)
    else:
        node = next((node for node in nodes if node["id"] == node_id), None)
        if not node:
            return None
    await register_output(
        session,
        project_id,
        node,
        source="generated",
        source_key=source_key,
        asset_id=asset_id,
        task_id=task_id,
        input_snapshot=input_snapshot,
    )
    canvas.nodes = nodes
    canvas.revision += 1
    canvas.updated_at = utc_now()
    return node_id


class NodeOutputs(OutputMutations):
    async def add(
        self, project_id: str, node_id: str, body, *, inspection_asset_id: str | None = None
    ):
        _, node = await self.document(project_id, node_id)
        if node["kind"] == "text":
            if body.text is None or body.asset_id is not None:
                raise OutputError("文本节点必须保存文本版本")
        else:
            asset = await self.session.get(VisualAsset, body.asset_id) if body.asset_id else None
            reference = await self.session.scalar(
                select(VisualProjectAssetReference.id).where(
                    VisualProjectAssetReference.project_id == project_id,
                    VisualProjectAssetReference.asset_id == body.asset_id,
                )
            )
            if (
                not asset
                or asset.owner_user_id != self.owner_user_id
                or (asset.project_id != project_id and not reference)
            ):
                raise OutputError("素材不属于当前项目", code="not_found", status=404)
            if asset.media_kind != node["kind"] or body.text is not None:
                raise OutputError("输出版本与节点类型不匹配")
        if inspection_asset_id:
            inspection = await self.session.get(VisualAsset, inspection_asset_id)
            if (
                node["kind"] != "video"
                or not inspection
                or inspection.owner_user_id != self.owner_user_id
                or inspection.project_id != project_id
                or inspection.mime_type != "video/webm"
            ):
                raise OutputError("检查视频不属于当前项目", code="not_found", status=404)
        await self.append(project_id, node_id, body, inspection_asset_id=inspection_asset_id)
        await self.session.commit()

    async def select_final(self, project_id: str, node_id: str, body):
        await self.set_final(project_id, node_id, body)
        await self.session.commit()

    async def delete(self, project_id: str, node_id: str, output_id: str, expected_revision: int):
        await self.remove(project_id, node_id, output_id, expected_revision)
        await self.session.commit()
