from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.visual_workshop.models import VisualGenerationBatch, VisualGenerationTask


async def reopen_batch_after_retry(session: AsyncSession, task: VisualGenerationTask) -> None:
    batch_id = str((task.request_payload or {}).get("generation_batch_id") or "")
    if not batch_id:
        return
    batch = await session.get(VisualGenerationBatch, batch_id)
    if batch is None or batch.status not in {"failed", "cancelled"}:
        return
    batch.status = "processing"
    batch.error_message = None
    batch.completed_at = None
    batch.updated_at = task.updated_at
    batch.revision += 1
