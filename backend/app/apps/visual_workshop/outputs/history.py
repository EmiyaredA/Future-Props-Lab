from copy import deepcopy

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.visual_workshop.acceptance.access import AcceptanceError, require_passed, required_for
from app.apps.visual_workshop.acceptance.models import AcceptanceRun
from app.apps.visual_workshop.models import VisualCanvasDocument, VisualWorkshopProject
from app.apps.visual_workshop.node_placement import automatic_node_position
from app.apps.visual_workshop.outputs.models import VisualNodeOutput
from app.apps.visual_workshop.outputs.schemas import VisualNodeOutputListOut, VisualNodeOutputOut
from app.apps.visual_workshop.schemas.workshop import (
    VisualCanvasDocumentOut,
    default_material_categories,
)
from app.capabilities.asset_store.models import VisualAsset, VisualProjectAssetReference
from app.runtime.ids import new_id
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import iso_utc, utc_now


class OutputError(Exception):
    def __init__(self, message: str, *, code: str = "invalid_output", status: int = 422):
        super().__init__(message)
        self.code, self.status = code, status


def output_out(row: VisualNodeOutput) -> VisualNodeOutputOut:
    return VisualNodeOutputOut(
        id=row.id,
        node_id=row.node_id,
        version=row.version,
        kind=row.kind,
        asset_id=row.asset_id,
        text=row.text,
        source=row.source,
        generation_task_id=row.generation_task_id,
        input_snapshot=row.input_snapshot or [],
        is_final=row.is_final,
        created_at=iso_utc(row.created_at),
    )


async def register_output(
    session: AsyncSession,
    project_id: str,
    node: dict,
    *,
    source: str,
    source_key: str,
    asset_id: str | None = None,
    text: str | None = None,
    task_id: str | None = None,
    input_snapshot: list[dict] | None = None,
) -> VisualNodeOutput:
    """Caller holds the canvas CAS write lock; duplicate completion is a no-op."""
    existing = await session.scalar(
        select(VisualNodeOutput).where(
            VisualNodeOutput.project_id == project_id, VisualNodeOutput.source_key == source_key
        )
    )
    if existing:
        return existing
    version = (
        await session.scalar(
            select(func.max(VisualNodeOutput.version)).where(
                VisualNodeOutput.project_id == project_id, VisualNodeOutput.node_id == node["id"]
            )
        )
    ) or 0
    candidate = await required_for(session, project_id, node["id"], node["kind"])
    if not candidate:
        await session.execute(
            update(VisualNodeOutput)
            .where(
                VisualNodeOutput.project_id == project_id, VisualNodeOutput.node_id == node["id"]
            )
            .values(is_final=False)
        )
    row = VisualNodeOutput(
        id=new_id(),
        project_id=project_id,
        node_id=node["id"],
        version=max(version, (node.get("output_sequence") or 0)) + 1,
        kind=node["kind"],
        asset_id=asset_id,
        text=text,
        source=source,
        source_key=source_key,
        generation_task_id=task_id,
        input_snapshot=input_snapshot or [],
        is_final=not candidate,
    )
    session.add(row)
    await session.flush()
    node["output_sequence"] = max((node.get("output_sequence") or 0), row.version)
    if not candidate:
        node.update(approved=False, final_output_id=row.id, final_version=row.version)
        if node["kind"] != "text":
            node["asset_id"] = asset_id
    return row


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


class NodeOutputs:
    def __init__(self, session: AsyncSession, workspace_id: str):
        self.session, self.workspace_id = session, workspace_id

    async def document(self, project_id: str, node_id: str):
        project = await self.session.scalar(
            select(VisualWorkshopProject).where(
                VisualWorkshopProject.id == project_id,
                VisualWorkshopProject.workspace_id == self.workspace_id,
            )
        )
        canvas = await self.session.get(VisualCanvasDocument, project_id) if project else None
        node = next((n for n in canvas.nodes if n["id"] == node_id), None) if canvas else None
        if node is None:
            raise OutputError("节点不存在", code="not_found", status=404)
        return canvas, node

    async def claim(self, canvas: VisualCanvasDocument, expected_revision: int):
        result = await self.session.execute(
            update(VisualCanvasDocument)
            .where(
                VisualCanvasDocument.project_id == canvas.project_id,
                VisualCanvasDocument.revision == expected_revision,
            )
            .values(revision=expected_revision + 1, updated_at=utc_now())
        )
        if result.rowcount != 1:
            project_id = canvas.project_id
            await self.session.rollback()
            current_row = await self.session.get(
                VisualCanvasDocument, project_id, populate_existing=True
            )
            current = VisualCanvasDocumentOut(
                project_id=current_row.project_id,
                nodes=current_row.nodes,
                edges=current_row.edges,
                revision=current_row.revision,
                updated_at=iso_utc(current_row.updated_at),
                categories=current_row.categories or default_material_categories(),
            )
            raise RevisionConflictError(
                expected_revision, current.revision, current.model_dump(mode="json")
            )

    async def list(self, project_id: str, node_id: str, page: int, page_size: int):
        await self.document(project_id, node_id)
        scope = (VisualNodeOutput.project_id == project_id, VisualNodeOutput.node_id == node_id)
        total = await self.session.scalar(
            select(func.count()).select_from(VisualNodeOutput).where(*scope)
        )
        rows = await self.session.scalars(
            select(VisualNodeOutput)
            .where(*scope)
            .order_by(VisualNodeOutput.version.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return VisualNodeOutputListOut(items=[output_out(row) for row in rows], total=total or 0)

    async def add(self, project_id: str, node_id: str, body):
        canvas, _ = await self.document(project_id, node_id)
        nodes = deepcopy(canvas.nodes)
        node = next(n for n in nodes if n["id"] == node_id)
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
                or asset.workspace_id != self.workspace_id
                or (asset.project_id != project_id and not reference)
            ):
                raise OutputError("素材不属于当前项目", code="not_found", status=404)
            if asset.media_kind != node["kind"] or body.text is not None:
                raise OutputError("输出版本与节点类型不匹配")
        await self.claim(canvas, body.expected_revision)
        output = await register_output(
            self.session,
            project_id,
            node,
            source="text" if node["kind"] == "text" else "uploaded",
            source_key=new_id(),
            asset_id=body.asset_id,
            text=body.text,
        )
        if node["kind"] == "text" and output.is_final:
            node["text"] = body.text
        canvas.nodes = nodes
        await self.session.commit()

    async def select_final(self, project_id: str, node_id: str, body):
        canvas, _ = await self.document(project_id, node_id)
        row = await self.session.scalar(
            select(VisualNodeOutput).where(
                VisualNodeOutput.project_id == project_id,
                VisualNodeOutput.node_id == node_id,
                VisualNodeOutput.id == body.output_id,
            )
        )
        if not row:
            raise OutputError("输出版本不存在", code="not_found", status=404)
        await self.claim(canvas, body.expected_revision)
        try:
            await require_passed(self.session, project_id, node_id, row.id)
        except AcceptanceError as exc:
            raise OutputError(str(exc), code=exc.code, status=exc.status) from None
        await self.session.execute(
            update(VisualNodeOutput)
            .where(VisualNodeOutput.project_id == project_id, VisualNodeOutput.node_id == node_id)
            .values(is_final=False)
        )
        row.is_final = True
        nodes = deepcopy(canvas.nodes)
        node = next(n for n in nodes if n["id"] == node_id)
        if node.get("final_output_id") != row.id:
            node["approved"] = False
        node.update(
            final_output_id=row.id,
            final_version=row.version,
            output_sequence=max((node.get("output_sequence") or 0), row.version),
        )
        if node["kind"] != "text":
            node["asset_id"] = row.asset_id
        else:
            node["text"] = row.text or ""
        canvas.nodes = nodes
        await self.session.commit()

    async def get(self, project_id: str, node_id: str, output_id: str):
        await self.document(project_id, node_id)
        row = await self.session.scalar(
            select(VisualNodeOutput).where(
                VisualNodeOutput.project_id == project_id,
                VisualNodeOutput.node_id == node_id,
                VisualNodeOutput.id == output_id,
            )
        )
        if not row:
            raise OutputError("输出版本不存在", code="not_found", status=404)
        return output_out(row)

    async def delete(self, project_id: str, node_id: str, output_id: str, expected_revision: int):
        canvas, node = await self.document(project_id, node_id)
        output = await self.get(project_id, node_id, output_id)
        if any(edge.get("output_id") == output_id for edge in canvas.edges or []):
            raise OutputError("请先解除固定引用，再删除版本", code="output_in_use", status=409)

        if await self.session.scalar(
            select(AcceptanceRun.id).where(AcceptanceRun.output_id == output_id)
        ):
            raise OutputError("版本被验收记录引用，不能删除", code="output_in_use", status=409)
        is_final = node.get("final_output_id") == output_id
        if is_final and output.source != "uploaded":
            raise OutputError("请先切换最终输出，再删除版本", code="output_in_use", status=409)
        await self.claim(canvas, expected_revision)
        if is_final:
            replacement = await self.session.scalar(
                select(VisualNodeOutput)
                .where(
                    VisualNodeOutput.project_id == project_id,
                    VisualNodeOutput.node_id == node_id,
                    VisualNodeOutput.id != output_id,
                )
                .order_by(VisualNodeOutput.version.desc())
                .limit(1)
            )
            nodes = deepcopy(canvas.nodes)
            target = next(n for n in nodes if n["id"] == node_id)
            target.update(
                approved=False,
                final_output_id=replacement.id if replacement else None,
                final_version=replacement.version if replacement else None,
                asset_id=replacement.asset_id if replacement else None,
            )
            if replacement and await required_for(self.session, project_id, node_id):
                try:
                    await require_passed(self.session, project_id, node_id, replacement.id)
                except AcceptanceError as exc:
                    raise OutputError(str(exc), code=exc.code, status=exc.status) from None
            if replacement:
                replacement.is_final = True
            # Keep output_sequence so deleting the last version never reuses a number.
            canvas.nodes = nodes
        await self.session.execute(
            delete(VisualNodeOutput).where(
                VisualNodeOutput.project_id == project_id,
                VisualNodeOutput.node_id == node_id,
                VisualNodeOutput.id == output_id,
            )
        )
        await self.session.commit()
