"""Account-bound batch lookup; the caller owns the session and transaction."""

from studio.apps.model_service.catalog.visual_generation import VisualGenerationValidationError
from studio.apps.model_service.storage.visual_generation_records import VisualProviderBatch


def batch_conflict():
    return VisualGenerationValidationError(
        "模型生成批次状态或摘要不匹配", code="visual_generation_batch_conflict", status=409
    )


async def load_batch(session, project, identity, digest):
    row = await session.get(VisualProviderBatch, identity)
    if row is not None and (row.project_id, row.plan_sha256) != (project, digest):
        raise batch_conflict()
    return row
