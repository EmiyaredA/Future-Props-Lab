from __future__ import annotations

import asyncio
import contextlib
import time
from collections.abc import AsyncIterator, Callable
from uuid import uuid4

import httpx
from sqlalchemy import select, update

from studio.apps.model_service.providers.agent import HttpAgentAdapter
from studio.apps.model_service.storage.models.call_log import LlmCallLog
from studio.apps.visual_workshop.assistant.conversations import (
    PreparedAssistantGeneration,
    message_out,
)
from studio.apps.visual_workshop.assistant.tools import build_visual_agent_definition
from studio.apps.visual_workshop.assistant_action_records import (
    cancel_active_actions,
    persist_agent_event,
)
from studio.apps.visual_workshop.assistant_values import action_out
from studio.apps.visual_workshop.assistant_values import sse_frame as _event
from studio.apps.visual_workshop.storage.models import (
    VisualAssistantAction,
    VisualAssistantConversation,
    VisualAssistantMessage,
)
from studio.contracts.agent_runtime.dialogue import AgentMessage
from studio.runtime.database.ownership import bind_owner
from studio.runtime.tasks.reactive_tools.loop import ReactiveToolLoop
from studio.runtime.tasks.reactive_tools.types import AgentEvent, RunStatus
from studio.runtime.time import utc_now


def build_model_adapter(
    prepared: PreparedAssistantGeneration, api_key: str, *, transport_resolver
) -> HttpAgentAdapter:
    return HttpAgentAdapter(
        kind=prepared.provider_kind,
        base_url=prepared.base_url,
        api_key=api_key,
        transport=transport_resolver(prepared.base_url),
    )


async def _settle(
    prepared: PreparedAssistantGeneration,
    *,
    sessions,
    run_id: str,
    content: str,
    status: str,
    run_status: str,
    error_message: str | None,
    trace_id: str,
    started: float,
    prompt_tokens: int | None,
    completion_tokens: int | None,
    total_tokens: int | None,
    rounds: int,
    first_token_latency_ms: int | None,
    finish_reason: str,
) -> tuple[VisualAssistantMessage, list, LlmCallLog, int]:
    latency_ms = max(0, round((time.monotonic() - started) * 1000))
    async with sessions() as session:
        bind_owner(session.sync_session, prepared.owner_user_id)
        message = await session.get(VisualAssistantMessage, prepared.assistant_message_id)
        conversation = await session.get(VisualAssistantConversation, prepared.conversation_id)
        if message is None or conversation is None:
            raise RuntimeError("视觉工坊对话已不存在")
        if message.status == "pending":
            message.content = content
            message.status = status
            message.error_message = error_message
            message.updated_at = utc_now()
        result = await session.execute(
            update(VisualAssistantConversation)
            .where(VisualAssistantConversation.id == prepared.conversation_id)
            .values(
                revision=VisualAssistantConversation.revision + 1,
                updated_at=utc_now(),
            )
        )
        if result.rowcount != 1:
            raise RuntimeError("视觉工坊对话结算失败")
        await session.refresh(conversation)
        action_rows = list(
            (
                await session.execute(
                    select(VisualAssistantAction)
                    .where(VisualAssistantAction.message_id == message.id)
                    .order_by(VisualAssistantAction.position)
                )
            )
            .scalars()
            .all()
        )
        actions = [action_out(item) for item in action_rows]
        action_log = [
            {
                "tool_name": item.tool_name,
                "effect": item.effect,
                "status": item.status,
                "duration_ms": item.duration_ms,
                "canvas_revision": item.canvas_revision,
                "generation_task_id": item.generation_task_id,
                "input": item.display_payload,
                "result": item.result_payload,
                "error_message": item.error_message,
            }
            for item in action_rows
        ]
        request_payload = {
            **prepared.request_payload,
            "run_id": run_id,
            "agent_mode": "tools" if prepared.tools_enabled else "advice",
            "rounds": rounds,
            "actions": action_log,
        }
        log = LlmCallLog(
            owner_user_id=prepared.owner_user_id,
            call_source="visual_workshop_assistant",
            provider_kind=prepared.provider_kind,
            model=prepared.model_slug,
            trace_id=trace_id,
            request_payload=request_payload,
            response_payload={
                "status": status,
                "run_status": run_status,
                "actions": action_log,
                "finish_reason": finish_reason,
                "first_token_latency_ms": first_token_latency_ms,
                "rounds": rounds,
            },
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            latency_ms=latency_ms,
            status="success" if status == "completed" else "error",
            error_message=error_message,
            auth_kind=prepared.auth_kind,
            api_key_id=prepared.api_key_id,
            api_key_name=prepared.api_key_name,
            api_key_prefix=prepared.api_key_prefix,
        )
        session.add(log)
        await session.commit()
        await session.refresh(message)
        await session.refresh(log)
        return message, actions, log, conversation.revision


async def assistant_events(
    prepared: PreparedAssistantGeneration,
    *,
    sessions,
    admission=None,
    transport_resolver,
    decrypt: Callable[[str], str],
    approvals,
) -> AsyncIterator[bytes]:
    sequence = 0
    trace_id = str(uuid4())
    started = time.monotonic()
    key = decrypt(prepared.api_key_ciphertext) if prepared.api_key_ciphertext else ""
    definition = build_visual_agent_definition(
        owner_user_id=prepared.owner_user_id,
        project_id=prepared.project_id,
        model=prepared.model_slug,
        tools_enabled=prepared.tools_enabled,
        image_model_id=prepared.image_model_id,
        image_model_slug=prepared.image_model_slug,
        video_model_id=prepared.video_model_id,
        video_model_slug=prepared.video_model_slug,
        admission=admission,
        sessions=sessions,
    )
    adapter = build_model_adapter(prepared, key, transport_resolver=transport_resolver)
    harness = ReactiveToolLoop(
        approvals=approvals,
        adapter=adapter,
        definition=definition,
        scope={
            "owner_user_id": prepared.owner_user_id,
            "project_id": prepared.project_id,
            "conversation_id": prepared.conversation_id,
            "canvas_revision": prepared.canvas_revision,
            "image_model_id": prepared.image_model_id,
            "video_model_id": prepared.video_model_id,
        },
    )
    yield _event(
        "start",
        sequence,
        {
            "run_id": harness.run_id,
            "conversation_id": prepared.conversation_id,
            "assistant_message_id": prepared.assistant_message_id,
            "turn_id": prepared.turn_id,
            "model": prepared.model_slug,
            "model_changed_from": prepared.model_changed_from,
            "agent_mode": "tools" if prepared.tools_enabled else "advice",
            "trace_id": trace_id,
            "revision": prepared.revision,
            "canvas_revision": prepared.canvas_revision,
            "attachment_warnings": list(prepared.attachment_warnings),
        },
    )
    sequence += 1
    queue: asyncio.Queue[tuple[str, object]] = asyncio.Queue()
    messages = [
        AgentMessage(role=item.role, text=item.text, images=item.images)
        for item in prepared.messages
    ]

    async def listener(event: AgentEvent) -> None:
        await queue.put(("event", event))

    async def worker() -> None:
        try:
            result = await harness.run(
                messages=messages,
                user_text=prepared.messages[-1].text if prepared.messages else "",
                listener=listener,
            )
            await queue.put(("result", result))
        except BaseException as exc:  # noqa: BLE001
            await queue.put(("exception", exc))

    task = asyncio.create_task(worker())
    content = ""
    rounds = 0
    first_token_latency_ms: int | None = None
    try:
        while True:
            kind, item = await queue.get()
            if kind == "event":
                event = item
                assert isinstance(event, AgentEvent)
                rounds = max(rounds, event.round_index + 1)
                if event.type == "model_text_delta":
                    text = str(event.payload.get("text") or "")
                    if text and first_token_latency_ms is None:
                        first_token_latency_ms = max(0, round((time.monotonic() - started) * 1000))
                    content += text
                    yield _event(
                        "delta",
                        sequence,
                        {"assistant_message_id": prepared.assistant_message_id, "text": text},
                    )
                    sequence += 1
                    continue
                if event.type.startswith("tool_") or event.type in {
                    "approval_requested",
                    "approval_resolved",
                    "run_cancelled",
                }:
                    actions = await persist_agent_event(
                        sessions, prepared.owner_user_id, prepared.assistant_message_id, event
                    )
                    yield _event(
                        "step",
                        sequence,
                        {
                            "run_id": harness.run_id,
                            "actions": [x.model_dump(mode="json") for x in actions],
                        },
                    )
                    sequence += 1
                if event.type == "approval_requested":
                    yield _event(
                        "approval_required",
                        sequence,
                        {"run_id": harness.run_id, **event.payload},
                    )
                    sequence += 1
                elif event.type == "approval_resolved":
                    yield _event(
                        "approval_resolved",
                        sequence,
                        {"run_id": harness.run_id, **event.payload},
                    )
                    sequence += 1
                elif event.type == "tool_completed":
                    observation = dict(event.payload.get("observation") or {})
                    if "canvas_revision" in observation and "nodes" in observation:
                        yield _event(
                            "canvas_updated",
                            sequence,
                            {
                                "canvas_revision": observation["canvas_revision"],
                                "nodes": observation["nodes"],
                            },
                        )
                        sequence += 1
                    if isinstance(observation.get("task"), dict):
                        yield _event(
                            "generation_task_created",
                            sequence,
                            {
                                "task": observation["task"],
                                "node": observation.get("node"),
                            },
                        )
                        sequence += 1
                continue
            if kind == "exception":
                exc = item
                if isinstance(exc, asyncio.CancelledError):
                    raise exc
                if isinstance(exc, BaseException):
                    raise exc
                raise RuntimeError("Agent 运行失败")
            result = item
            run_status = result.status
            usage = result.usage
            if run_status == RunStatus.COMPLETED:
                message, actions, log, revision = await _settle(
                    prepared,
                    sessions=sessions,
                    run_id=harness.run_id,
                    content=result.final_text,
                    status="completed",
                    run_status=run_status.value,
                    error_message=None,
                    trace_id=trace_id,
                    started=started,
                    prompt_tokens=usage.prompt_tokens,
                    completion_tokens=usage.completion_tokens,
                    total_tokens=usage.total_tokens,
                    rounds=rounds,
                    first_token_latency_ms=first_token_latency_ms,
                    finish_reason="stop",
                )
                yield _event(
                    "done",
                    sequence,
                    {
                        "message": message_out(message, actions=actions).model_dump(mode="json"),
                        "run_id": harness.run_id,
                        "run_status": run_status.value,
                        "log_id": log.id,
                        "trace_id": trace_id,
                        "prompt_tokens": usage.prompt_tokens,
                        "completion_tokens": usage.completion_tokens,
                        "total_tokens": usage.total_tokens,
                        "latency_ms": log.latency_ms,
                        "revision": revision,
                    },
                )
                return
            error_message = result.reason or "Agent 未完成本轮任务"
            await cancel_active_actions(
                sessions, prepared.owner_user_id, prepared.assistant_message_id, error_message
            )
            message, actions, log, revision = await _settle(
                prepared,
                sessions=sessions,
                run_id=harness.run_id,
                content=result.final_text,
                status="error",
                run_status=run_status.value,
                error_message=error_message,
                trace_id=trace_id,
                started=started,
                prompt_tokens=usage.prompt_tokens,
                completion_tokens=usage.completion_tokens,
                total_tokens=usage.total_tokens,
                rounds=rounds,
                first_token_latency_ms=first_token_latency_ms,
                finish_reason=run_status.value,
            )
            yield _event(
                "error",
                sequence,
                {
                    "code": run_status.value,
                    "message": error_message,
                    "message_state": message_out(message, actions=actions).model_dump(mode="json"),
                    "run_id": harness.run_id,
                    "log_id": log.id,
                    "trace_id": trace_id,
                    "revision": revision,
                },
            )
            return
    except asyncio.CancelledError:
        await harness.abort()
        task.cancel()
        await cancel_active_actions(
            sessions, prepared.owner_user_id, prepared.assistant_message_id, "用户停止生成"
        )
        await asyncio.shield(
            _settle(
                prepared,
                sessions=sessions,
                run_id=harness.run_id,
                content=content,
                status="cancelled",
                run_status="cancelled",
                error_message="用户停止生成",
                trace_id=trace_id,
                started=started,
                prompt_tokens=None,
                completion_tokens=None,
                total_tokens=None,
                rounds=rounds,
                first_token_latency_ms=first_token_latency_ms,
                finish_reason="cancelled",
            )
        )
        raise
    except Exception as exc:
        task.cancel()
        await harness.abort()
        timeout = (
            isinstance(exc, (httpx.TimeoutException, TimeoutError))
            or str(exc) == "model_turn_timeout"
        )
        message_text = "模型调用超时" if timeout else "Agent 运行失败"
        await cancel_active_actions(
            sessions, prepared.owner_user_id, prepared.assistant_message_id, message_text
        )
        message, actions, log, revision = await _settle(
            prepared,
            sessions=sessions,
            run_id=harness.run_id,
            content=content,
            status="error",
            run_status="failed",
            error_message=f"{message_text}：{str(exc)[:1000]}",
            trace_id=trace_id,
            started=started,
            prompt_tokens=None,
            completion_tokens=None,
            total_tokens=None,
            rounds=rounds,
            first_token_latency_ms=first_token_latency_ms,
            finish_reason="error",
        )
        yield _event(
            "error",
            sequence,
            {
                "code": "model_timeout" if timeout else "agent_failed",
                "message": message_text,
                "detail": str(exc)[:1000],
                "message_state": message_out(message, actions=actions).model_dump(mode="json"),
                "run_id": harness.run_id,
                "log_id": log.id,
                "trace_id": trace_id,
                "revision": revision,
            },
        )
    finally:
        if not task.done():
            task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
