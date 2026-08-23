from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator
from uuid import uuid4

from sqlalchemy import select, update

from app.agents.harness import (
    AgentDefinition,
    AgentEvent,
    AgentHarness,
    AgentMessage,
    Observation,
    RunBudgets,
    RunStatus,
    ToolBinding,
)
from app.core.credentials import decrypt_secret
from app.core.db import SessionLocal
from app.core.tenant_context import bind_workspace
from app.core.time import utc_now
from app.llm.playground.service import PreparedGeneration, message_out
from app.llm.playground.test_tools import call_out, execute_test_tool, model_result_text
from app.llm.providers.agent import HttpAgentAdapter
from app.models import LlmCallLog, ModelTestConversation, ModelTestMessage, ModelTestToolCall


def _event(event_type: str, sequence: int, payload: dict) -> bytes:
    envelope = {"type": event_type, "schema_version": 2, "sequence": sequence, "payload": payload}
    return f"data: {json.dumps(envelope, ensure_ascii=False)}\n\n".encode()


async def recover_interrupted_model_test_runs() -> None:
    async with SessionLocal() as session:
        messages = list(
            (
                await session.execute(
                    select(ModelTestMessage).where(ModelTestMessage.status == "pending")
                )
            )
            .scalars()
            .all()
        )
        conversation_ids = {item.conversation_id for item in messages}
        for message in messages:
            message.status = "cancelled"
            message.error_message = "服务重启，本轮运行已取消"
            message.updated_at = utc_now()
        await session.execute(
            update(ModelTestToolCall)
            .where(ModelTestToolCall.status.in_(["proposed", "running"]))
            .values(
                status="cancelled", error_message="服务重启，本轮运行已取消", updated_at=utc_now()
            )
        )
        if conversation_ids:
            await session.execute(
                update(ModelTestConversation)
                .where(ModelTestConversation.id.in_(conversation_ids))
                .values(revision=ModelTestConversation.revision + 1, updated_at=utc_now())
            )
        await session.commit()


def _bindings(snapshots: tuple[dict, ...]) -> tuple[ToolBinding, ...]:
    bindings: list[ToolBinding] = []
    for snapshot in snapshots:

        async def handler(arguments, _context, current=snapshot):
            result = await execute_test_tool(current, arguments)
            return Observation(
                action_id=_context.tool_call_id,
                tool_name=current["name"],
                success=result.success,
                model_text=model_result_text(result),
                data={"result": result.result} if result.success else {},
                error_code=result.error_code,
                retryable=result.error_code == "invalid_arguments",
                duration_ms=result.duration_ms,
            )

        bindings.append(
            ToolBinding(
                name=snapshot["name"],
                description=snapshot["description"],
                input_schema=snapshot["input_schema"],
                effect="read",
                handler=handler,
                summarize=lambda arguments: dict(arguments),
                timeout_seconds=15,
            )
        )
    return tuple(bindings)


async def _persist_event(prepared: PreparedGeneration, event: AgentEvent) -> list[dict]:
    snapshots = {item["name"]: item for item in prepared.tool_snapshots}
    async with SessionLocal() as session:
        bind_workspace(session.sync_session, prepared.workspace_id)
        payload = event.payload
        action_id = str(payload.get("action_id") or "")
        row = None
        if action_id:
            row = await session.scalar(
                select(ModelTestToolCall).where(
                    ModelTestToolCall.message_id == prepared.assistant_message_id,
                    ModelTestToolCall.action_id == action_id,
                )
            )
        if event.type == "tool_proposed" and row is None:
            name = str(payload.get("tool_name") or "")
            snapshot = snapshots.get(name, {"name": name, "revision": 0, "delay_ms": 0})
            row = ModelTestToolCall(
                workspace_id=prepared.workspace_id,
                tool_id=snapshot.get("id"),
                conversation_id=prepared.conversation_id,
                message_id=prepared.assistant_message_id,
                source="model_test",
                action_id=action_id,
                run_id=event.run_id,
                round_index=event.round_index,
                tool_name=name,
                tool_revision=int(snapshot.get("revision") or 0),
                definition_snapshot=snapshot,
                arguments=dict(payload.get("summary") or {}),
                status="proposed",
                configured_delay_ms=int(snapshot.get("delay_ms") or 0),
            )
            session.add(row)
        elif event.type == "tool_started" and row is not None:
            row.status = "running"
            row.updated_at = utc_now()
        elif event.type in {"tool_completed", "tool_failed"} and row is not None:
            observation = dict(payload.get("observation") or {})
            row.status = "completed" if event.type == "tool_completed" else "failed"
            row.success = event.type == "tool_completed"
            row.result = observation.get("result")
            row.error_code = str(payload.get("error_code") or "")
            row.error_message = (
                ""
                if event.type == "tool_completed"
                else str(payload.get("model_text") or "工具失败")
            )[:1000]
            row.duration_ms = int(payload.get("duration_ms") or 0)
            row.updated_at = utc_now()
        elif event.type == "run_cancelled":
            await session.execute(
                update(ModelTestToolCall)
                .where(
                    ModelTestToolCall.message_id == prepared.assistant_message_id,
                    ModelTestToolCall.status.in_(["proposed", "running"]),
                )
                .values(status="cancelled", error_message="运行已取消", updated_at=utc_now())
            )
        await session.commit()
        rows = list(
            (
                await session.execute(
                    select(ModelTestToolCall)
                    .where(ModelTestToolCall.message_id == prepared.assistant_message_id)
                    .order_by(ModelTestToolCall.created_at)
                )
            )
            .scalars()
            .all()
        )
        return [item.model_dump(mode="json") for item in map(call_out, rows)]


async def _settle(
    prepared: PreparedGeneration,
    *,
    content: str,
    status: str,
    run_status: str,
    error_message: str | None,
    trace_id: str,
    run_id: str,
    started: float,
    rounds: int,
    usage,
) -> tuple[ModelTestMessage, LlmCallLog, int]:
    latency_ms = max(0, round((time.monotonic() - started) * 1000))
    async with SessionLocal() as session:
        bind_workspace(session.sync_session, prepared.workspace_id)
        message = await session.get(ModelTestMessage, prepared.assistant_message_id)
        conversation = await session.get(ModelTestConversation, prepared.conversation_id)
        if message is None or conversation is None:
            raise RuntimeError("模型测试会话已不存在")
        message.content = content
        message.status = status
        message.error_message = error_message
        message.updated_at = utc_now()
        await session.execute(
            update(ModelTestConversation)
            .where(ModelTestConversation.id == prepared.conversation_id)
            .values(revision=ModelTestConversation.revision + 1, updated_at=utc_now())
        )
        await session.refresh(conversation)
        calls = list(
            (
                await session.execute(
                    select(ModelTestToolCall)
                    .where(ModelTestToolCall.message_id == message.id)
                    .order_by(ModelTestToolCall.created_at)
                )
            )
            .scalars()
            .all()
        )
        action_log = [
            {
                "tool_name": item.tool_name,
                "tool_revision": item.tool_revision,
                "arguments": item.arguments,
                "status": item.status,
                "result": item.result,
                "error_code": item.error_code,
                "error_message": item.error_message,
                "duration_ms": item.duration_ms,
            }
            for item in calls
        ]
        log = LlmCallLog(
            workspace_id=prepared.workspace_id,
            call_source="model_playground",
            provider_kind=prepared.provider_kind,
            model=prepared.model_slug,
            trace_id=trace_id,
            request_payload={
                "model": prepared.model_slug,
                "conversation_id": prepared.conversation_id,
                "run_id": run_id,
                **prepared.request_payload,
                "actions": action_log,
            },
            response_payload={
                "content": content,
                "status": status,
                "run_status": run_status,
                "rounds": rounds,
                "actions": action_log,
            },
            prompt_tokens=usage.prompt_tokens,
            completion_tokens=usage.completion_tokens,
            total_tokens=usage.total_tokens,
            latency_ms=latency_ms,
            status="success" if status == "completed" else "error",
            error_message=error_message,
        )
        session.add(log)
        await session.commit()
        await session.refresh(message)
        await session.refresh(log)
        return message, log, conversation.revision


async def tool_generation_events(prepared: PreparedGeneration) -> AsyncIterator[bytes]:
    sequence = 0
    trace_id = str(uuid4())
    started = time.monotonic()
    key = decrypt_secret(prepared.api_key_ciphertext) if prepared.api_key_ciphertext else ""
    harness = AgentHarness(
        adapter=HttpAgentAdapter(
            kind=prepared.provider_kind,
            base_url=prepared.base_url,
            api_key=key,
        ),
        definition=AgentDefinition(
            id="model-test-tools",
            model=prepared.model_slug,
            instructions=prepared.system_prompt,
            tools=_bindings(prepared.tool_snapshots),
            budgets=RunBudgets(max_rounds=6, max_tool_failures=3),
            temperature=prepared.temperature,
            max_tokens=prepared.max_tokens,
        ),
        scope={"workspace_id": prepared.workspace_id, "conversation_id": prepared.conversation_id},
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
            "trace_id": trace_id,
            "revision": prepared.revision,
            "replaced_message_id": prepared.replaced_message_id,
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
            result = await harness.run(messages=messages, user_text="", listener=listener)
            await queue.put(("result", result))
        except BaseException as exc:  # noqa: BLE001
            await queue.put(("exception", exc))

    task = asyncio.create_task(worker())
    content = ""
    rounds = 0
    try:
        while True:
            kind, item = await queue.get()
            if kind == "event":
                event = item
                assert isinstance(event, AgentEvent)
                rounds = max(rounds, event.round_index + 1)
                if event.type == "model_text_delta":
                    text = str(event.payload.get("text") or "")
                    content += text
                    yield _event(
                        "delta",
                        sequence,
                        {"assistant_message_id": prepared.assistant_message_id, "text": text},
                    )
                    sequence += 1
                elif event.type.startswith("tool_") or event.type == "run_cancelled":
                    calls = await _persist_event(prepared, event)
                    yield _event("step", sequence, {"run_id": harness.run_id, "tool_calls": calls})
                    sequence += 1
                continue
            if kind == "exception":
                if isinstance(item, BaseException):
                    raise item
                raise RuntimeError("Agent 运行失败")
            result = item
            if result.status == RunStatus.COMPLETED:
                message, log, revision = await _settle(
                    prepared,
                    content=result.final_text,
                    status="completed",
                    run_status=result.status.value,
                    error_message=None,
                    trace_id=trace_id,
                    run_id=harness.run_id,
                    started=started,
                    rounds=rounds,
                    usage=result.usage,
                )
                yield _event(
                    "done",
                    sequence,
                    {
                        "message": message_out(message).model_dump(mode="json"),
                        "run_id": harness.run_id,
                        "run_status": result.status.value,
                        "rounds": rounds,
                        "log_id": log.id,
                        "trace_id": trace_id,
                        "revision": revision,
                    },
                )
                return
            reason = result.reason or "工具调用未完成"
            message, log, revision = await _settle(
                prepared,
                content=result.final_text,
                status="error",
                run_status=result.status.value,
                error_message=reason,
                trace_id=trace_id,
                run_id=harness.run_id,
                started=started,
                rounds=rounds,
                usage=result.usage,
            )
            yield _event(
                "error",
                sequence,
                {
                    "code": result.status.value,
                    "message": reason,
                    "message_state": message_out(message).model_dump(mode="json"),
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
        await _persist_event(prepared, AgentEvent("run_cancelled", harness.run_id))
        raise
    finally:
        if not task.done():
            task.cancel()
