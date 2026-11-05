"""Public video editor entry for approved assistant timeline operations."""

from __future__ import annotations

from typing import Any

from app.runtime.db import SessionLocal
from studio.apps.video_editor.errors import VideoEditorNotFoundError, VideoEditorValidationError
from studio.apps.video_editor.schemas.timeline import VideoEditorTimelineBatchIn
from studio.apps.video_editor.timeline import VideoEditorTimelines
from studio.runtime.database.operation_receipts import OperationError
from studio.runtime.database.ownership import bind_owner


async def apply_assistant_timeline_batch(
    owner_user_id: str, action_id: str, project_id: str, arguments: dict[str, Any]
) -> dict[str, Any]:
    body = VideoEditorTimelineBatchIn.model_validate(
        {
            "expectedRevision": arguments.get("expected_revision"),
            "requestId": action_id,
            "operations": arguments.get("operations"),
        }
    )
    try:
        async with SessionLocal() as session:
            bind_owner(session, owner_user_id)
            outcome = await VideoEditorTimelines(session, owner_user_id).apply(project_id, body)
    except (VideoEditorNotFoundError, VideoEditorValidationError) as exc:
        raise OperationError(str(exc), getattr(exc, "code", "execution_failed"), 422) from exc
    return {
        **outcome.model_dump(mode="json", by_alias=True),
        "operationResults": [
            {"index": index + 1, "type": operation.type, "status": "completed"}
            for index, operation in enumerate(body.operations)
        ],
    }
