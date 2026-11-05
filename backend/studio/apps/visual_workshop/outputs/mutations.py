"""Edit the output selection and history under the owning Canvas CAS."""

from copy import deepcopy

from sqlalchemy import delete, select, update

from studio.apps.visual_workshop.acceptance.models import AcceptanceRun
from studio.apps.visual_workshop.canvas_values import canvas_out
from studio.apps.visual_workshop.outputs.models import VisualNodeOutput
from studio.apps.visual_workshop.outputs.queries import OutputError, OutputQueries
from studio.apps.visual_workshop.outputs.recording import register_output
from studio.apps.visual_workshop.schemas.workshop import (
    VisualCanvasDocumentOut,
    default_material_categories,
)
from studio.apps.visual_workshop.storage.models import VisualCanvasDocument
from studio.runtime.ids import new_id
from studio.runtime.revisions import RevisionConflictError
from studio.runtime.time import iso_utc, utc_now


class OutputMutations(OutputQueries):
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
            if current_row is None:
                raise OutputError("节点不存在", code="not_found", status=404)
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

    async def append(self, project_id, node_id, body, *, inspection_asset_id=None):
        canvas, _ = await self.document(project_id, node_id)
        nodes = deepcopy(canvas.nodes)
        node = next(node for node in nodes if node["id"] == node_id)
        await self.claim(canvas, body.expected_revision)
        output = await register_output(
            self.session,
            project_id,
            node,
            source="text" if node["kind"] == "text" else "uploaded",
            source_key=new_id(),
            asset_id=body.asset_id,
            inspection_asset_id=inspection_asset_id,
            text=body.text,
        )
        if node["kind"] == "text" and output.is_final:
            node["text"] = body.text
        canvas.nodes = nodes
        return canvas_out(canvas)

    async def set_final(self, project_id: str, node_id: str, body):
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
        return canvas_out(canvas)

    async def deletion(self, project_id, node_id, output_id):
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
        replacement = None
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
        return canvas, is_final, replacement

    async def remove(self, project_id, node_id, output_id, expected_revision):
        canvas, is_final, replacement = await self.deletion(project_id, node_id, output_id)
        await self.claim(canvas, expected_revision)
        if is_final:
            nodes = deepcopy(canvas.nodes)
            target = next(n for n in nodes if n["id"] == node_id)
            target.update(
                approved=False,
                final_output_id=replacement.id if replacement else None,
                final_version=replacement.version if replacement else None,
                asset_id=replacement.asset_id if replacement else None,
            )
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
        return canvas_out(canvas)
