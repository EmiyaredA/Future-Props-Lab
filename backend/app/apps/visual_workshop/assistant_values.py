"""Serialize Visual assistant records without provider or storage access."""

import json

from app.apps.visual_workshop.models import VisualAssistantAction, VisualAssistantMessage
from app.apps.visual_workshop.schemas.workshop import (
    VisualAssistantActionOut,
    VisualAssistantAssetOut,
    VisualAssistantMessageOut,
)
from app.runtime.time import iso_utc


def action_out(row: VisualAssistantAction) -> VisualAssistantActionOut:
    return VisualAssistantActionOut(
        id=row.id,
        action_id=row.action_id,
        run_id=row.run_id,
        approval_group_id=row.approval_group_id,
        position=row.position,
        tool_name=row.tool_name,
        effect=row.effect,
        status=row.status,
        display_payload=dict(row.display_payload or {}),
        result_payload=dict(row.result_payload or {}),
        error_message=row.error_message,
        duration_ms=row.duration_ms,
        canvas_revision=row.canvas_revision,
        generation_task_id=row.generation_task_id,
        created_at=iso_utc(row.created_at),
        updated_at=iso_utc(row.updated_at),
    )


def asset_out(row) -> VisualAssistantAssetOut:
    return VisualAssistantAssetOut(
        id=row.id,
        display_name=row.display_name,
        mime_type=row.mime_type,
        byte_size=row.byte_size,
    )


def message_out(
    row: VisualAssistantMessage,
    assets=None,
    actions: list[VisualAssistantActionOut] | None = None,
) -> VisualAssistantMessageOut:
    return VisualAssistantMessageOut(
        id=row.id,
        turn_id=row.turn_id,
        role=row.role,
        content=row.content,
        model_slug=row.model_slug,
        status=row.status,
        error_message=row.error_message,
        created_at=iso_utc(row.created_at),
        content_parts=row.content_parts or [],
        assets=[asset_out(item) for item in assets or []],
        actions=actions or [],
    )


def sse_frame(event_type: str, sequence: int, payload: dict) -> bytes:
    envelope = {
        "type": event_type,
        "schema_version": 2,
        "sequence": sequence,
        "payload": payload,
    }
    return f"data: {json.dumps(envelope, ensure_ascii=False)}\n\n".encode()
