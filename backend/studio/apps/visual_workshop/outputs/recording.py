"""Record one Visual-owned node output under the caller's canvas write lock."""

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from studio.apps.visual_workshop.outputs.models import VisualNodeOutput
from studio.runtime.ids import new_id


async def register_output(
    session: AsyncSession,
    project_id: str,
    node: dict,
    *,
    source: str,
    source_key: str,
    asset_id: str | None = None,
    inspection_asset_id: str | None = None,
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
    await session.execute(
        update(VisualNodeOutput)
        .where(VisualNodeOutput.project_id == project_id, VisualNodeOutput.node_id == node["id"])
        .values(is_final=False)
    )
    row = VisualNodeOutput(
        id=new_id(),
        project_id=project_id,
        node_id=node["id"],
        version=max(version, (node.get("output_sequence") or 0)) + 1,
        kind=node["kind"],
        asset_id=asset_id,
        inspection_asset_id=inspection_asset_id,
        text=text,
        source=source,
        source_key=source_key,
        generation_task_id=task_id,
        input_snapshot=input_snapshot or [],
        is_final=True,
    )
    session.add(row)
    await session.flush()
    node["output_sequence"] = max((node.get("output_sequence") or 0), row.version)
    node.update(approved=False, final_output_id=row.id, final_version=row.version)
    if node["kind"] != "text":
        node["asset_id"] = asset_id
    return row
