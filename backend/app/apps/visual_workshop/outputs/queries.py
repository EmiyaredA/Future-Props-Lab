"""Read Visual-owned node output history after verifying the project and node."""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.visual_workshop.models import VisualCanvasDocument, VisualWorkshopProject
from app.apps.visual_workshop.outputs.models import VisualNodeOutput
from app.apps.visual_workshop.outputs.schemas import VisualNodeOutputListOut, VisualNodeOutputOut
from app.runtime.time import iso_utc


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
        inspection_asset_id=row.inspection_asset_id,
        text=row.text,
        source=row.source,
        generation_task_id=row.generation_task_id,
        input_snapshot=row.input_snapshot or [],
        is_final=row.is_final,
        created_at=iso_utc(row.created_at),
    )


class OutputQueries:
    def __init__(self, session: AsyncSession, owner_user_id: str):
        self.session, self.owner_user_id = session, owner_user_id

    async def document(self, project_id: str, node_id: str):
        project = await self.session.scalar(
            select(VisualWorkshopProject).where(
                VisualWorkshopProject.id == project_id,
                VisualWorkshopProject.owner_user_id == self.owner_user_id,
            )
        )
        canvas = await self.session.get(VisualCanvasDocument, project_id) if project else None
        node = next((n for n in canvas.nodes if n["id"] == node_id), None) if canvas else None
        if node is None:
            raise OutputError("节点不存在", code="not_found", status=404)
        return canvas, node

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
