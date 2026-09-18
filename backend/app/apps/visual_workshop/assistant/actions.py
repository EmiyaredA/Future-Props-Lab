from __future__ import annotations

from sqlalchemy import func, select, update

from app.apps.visual_workshop.models import (
    VisualAssistantAction,
    VisualAssistantConversation,
    VisualAssistantMessage,
)
from app.apps.visual_workshop.schemas.workshop import VisualAssistantActionOut
from app.capabilities.agents.harness import AgentEvent
from app.orm import bind_workspace
from app.runtime.db import SessionLocal
from app.runtime.time import iso_utc, utc_now

ACTIVE_ACTION_STATUSES = ("proposed", "waiting_approval", "running")


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


def _safe_result(payload: dict) -> tuple[dict, int | None, str | None]:
    observation = dict(payload.get("observation") or {})
    canvas_revision = observation.get("canvas_revision")
    task = observation.get("task")
    generation_task_id = str(task.get("id")) if isinstance(task, dict) and task.get("id") else None
    result = {
        key: value for key, value in observation.items() if key not in {"nodes", "request_payload"}
    }
    if payload.get("model_text"):
        result["message"] = str(payload["model_text"])[:1000]
    normalized_revision = int(canvas_revision) if isinstance(canvas_revision, int) else None
    return result, normalized_revision, generation_task_id


async def persist_agent_event(
    workspace_id: str, message_id: str, event: AgentEvent
) -> list[VisualAssistantActionOut]:
    async with SessionLocal() as session:
        bind_workspace(session.sync_session, workspace_id)
        payload = event.payload
        action_id = str(payload.get("action_id") or "")
        row = None
        if action_id:
            row = await session.scalar(
                select(VisualAssistantAction).where(
                    VisualAssistantAction.message_id == message_id,
                    VisualAssistantAction.action_id == action_id,
                )
            )
        if event.type == "tool_proposed" and row is None:
            position = int(
                await session.scalar(
                    select(func.count(VisualAssistantAction.id)).where(
                        VisualAssistantAction.message_id == message_id
                    )
                )
                or 0
            )
            row = VisualAssistantAction(
                message_id=message_id,
                action_id=action_id,
                run_id=event.run_id,
                position=position,
                tool_name=str(payload.get("tool_name") or ""),
                effect=str(payload.get("effect") or "read"),
                status="proposed",
                display_payload=dict(payload.get("summary") or {}),
            )
            session.add(row)
        elif event.type == "approval_requested":
            approval_id = str(payload.get("approval_id") or "")
            action_ids = [str(item.get("action_id")) for item in payload.get("actions") or []]
            await session.execute(
                update(VisualAssistantAction)
                .where(
                    VisualAssistantAction.message_id == message_id,
                    VisualAssistantAction.action_id.in_(action_ids),
                )
                .values(
                    approval_group_id=approval_id,
                    status="waiting_approval",
                    updated_at=utc_now(),
                )
            )
        elif event.type == "approval_resolved":
            approval_id = str(payload.get("approval_id") or "")
            if payload.get("decision") == "reject":
                await session.execute(
                    update(VisualAssistantAction)
                    .where(
                        VisualAssistantAction.message_id == message_id,
                        VisualAssistantAction.approval_group_id == approval_id,
                        VisualAssistantAction.status == "waiting_approval",
                    )
                    .values(
                        status="rejected",
                        error_message=str(payload.get("reason") or "用户拒绝了该操作"),
                        updated_at=utc_now(),
                    )
                )
        elif event.type == "tool_started" and row is not None:
            row.status = "running"
            row.updated_at = utc_now()
        elif event.type in {"tool_completed", "tool_failed"} and row is not None:
            result, canvas_revision, generation_task_id = _safe_result(payload)
            row.status = "completed" if event.type == "tool_completed" else "failed"
            row.result_payload = result
            row.error_message = (
                None
                if event.type == "tool_completed"
                else str(payload.get("model_text") or "工具失败")
            )
            row.duration_ms = int(payload.get("duration_ms") or 0)
            row.canvas_revision = canvas_revision
            row.generation_task_id = generation_task_id
            row.updated_at = utc_now()
        elif event.type == "run_cancelled":
            await session.execute(
                update(VisualAssistantAction)
                .where(
                    VisualAssistantAction.message_id == message_id,
                    VisualAssistantAction.status.in_(ACTIVE_ACTION_STATUSES),
                )
                .values(status="cancelled", error_message="运行已取消", updated_at=utc_now())
            )
        await session.commit()
        rows = list(
            (
                await session.execute(
                    select(VisualAssistantAction)
                    .where(VisualAssistantAction.message_id == message_id)
                    .order_by(VisualAssistantAction.position)
                )
            )
            .scalars()
            .all()
        )
        return [action_out(item) for item in rows]


async def cancel_active_actions(workspace_id: str, message_id: str, reason: str) -> None:
    async with SessionLocal() as session:
        bind_workspace(session.sync_session, workspace_id)
        await session.execute(
            update(VisualAssistantAction)
            .where(
                VisualAssistantAction.message_id == message_id,
                VisualAssistantAction.status.in_(ACTIVE_ACTION_STATUSES),
            )
            .values(status="cancelled", error_message=reason[:1000], updated_at=utc_now())
        )
        await session.commit()


async def recover_interrupted_visual_assistant_runs() -> None:
    async with SessionLocal() as session:
        message_rows = list(
            (
                await session.execute(
                    select(VisualAssistantMessage).where(VisualAssistantMessage.status == "pending")
                )
            )
            .scalars()
            .all()
        )
        conversation_ids = {item.conversation_id for item in message_rows}
        for message in message_rows:
            message.status = "cancelled"
            message.error_message = "服务重启，本轮运行已取消"
            message.updated_at = utc_now()
        await session.execute(
            update(VisualAssistantAction)
            .where(VisualAssistantAction.status.in_(ACTIVE_ACTION_STATUSES))
            .values(
                status="cancelled",
                error_message="服务重启，本轮运行已取消",
                updated_at=utc_now(),
            )
        )
        if conversation_ids:
            await session.execute(
                update(VisualAssistantConversation)
                .where(VisualAssistantConversation.id.in_(conversation_ids))
                .values(
                    revision=VisualAssistantConversation.revision + 1,
                    updated_at=utc_now(),
                )
            )
        await session.commit()
