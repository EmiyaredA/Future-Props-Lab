"""Account-bound inference receipt lookup before reserving additional execution capacity."""

from sqlalchemy import select

from app.llm.models.model_inference import ModelInferenceTask
from studio.runtime.database.operation_receipts import OperationError, fingerprint


async def replay_task(session, owner_user_id, body):
    row = await session.scalar(
        select(ModelInferenceTask).where(
            ModelInferenceTask.owner_user_id == owner_user_id,
            ModelInferenceTask.request_id == body.request_id,
        )
    )
    if row is not None and row.fingerprint != fingerprint(body):
        raise OperationError("request_id 已用于其他调用", "idempotency_conflict", 409)
    return row
