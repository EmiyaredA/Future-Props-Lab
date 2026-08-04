from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator
from uuid import uuid4

import httpx
from sqlalchemy import update

from app.core.credentials import decrypt_secret
from app.core.db import SessionLocal
from app.core.time import utc_now
from app.llm.providers import stream_text_completion
from app.models import LlmCallLog, VisualAssistantConversation, VisualAssistantMessage
from app.visual_workshop.assistant import PreparedAssistantGeneration, message_out


def _event(event_type: str, sequence: int, payload: dict) -> bytes:
    envelope = {
        "type": event_type,
        "schema_version": 2,
        "sequence": sequence,
        "payload": payload,
    }
    return f"data: {json.dumps(envelope, ensure_ascii=False)}\n\n".encode()


async def _settle(
    prepared: PreparedAssistantGeneration,
    *,
    content: str,
    status: str,
    error_message: str | None,
    trace_id: str,
    started: float,
    prompt_tokens: int | None,
    completion_tokens: int | None,
    total_tokens: int | None,
) -> tuple[VisualAssistantMessage, LlmCallLog, int]:
    latency_ms = max(0, round((time.monotonic() - started) * 1000))
    async with SessionLocal() as session:
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
        log = LlmCallLog(
            call_source="visual_workshop_assistant",
            provider_kind=prepared.provider_kind,
            model=prepared.model_slug,
            trace_id=trace_id,
            request_payload=prepared.request_payload,
            response_payload={"content": content, "status": status},
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            latency_ms=latency_ms,
            status="success" if status == "completed" else "error",
            error_message=error_message,
        )
        session.add(log)
        await session.commit()
        await session.refresh(message)
        await session.refresh(log)
        return message, log, conversation.revision


async def assistant_events(
    prepared: PreparedAssistantGeneration,
) -> AsyncIterator[bytes]:
    sequence = 0
    trace_id = str(uuid4())
    started = time.monotonic()
    content = ""
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    yield _event(
        "start",
        sequence,
        {
            "conversation_id": prepared.conversation_id,
            "assistant_message_id": prepared.assistant_message_id,
            "turn_id": prepared.turn_id,
            "model": prepared.model_slug,
            "model_changed_from": prepared.model_changed_from,
            "trace_id": trace_id,
            "revision": prepared.revision,
        },
    )
    sequence += 1
    try:
        key = decrypt_secret(prepared.api_key_ciphertext) if prepared.api_key_ciphertext else ""
        async for chunk in stream_text_completion(
            kind=prepared.provider_kind,
            base_url=prepared.base_url,
            api_key=key,
            model=prepared.model_slug,
            system_prompt=prepared.system_prompt,
            messages=prepared.messages,
            temperature=0.7,
            max_tokens=2048,
        ):
            prompt_tokens = chunk.prompt_tokens or prompt_tokens
            completion_tokens = chunk.completion_tokens or completion_tokens
            total_tokens = chunk.total_tokens or total_tokens
            if chunk.text:
                content += chunk.text
                yield _event(
                    "delta",
                    sequence,
                    {
                        "assistant_message_id": prepared.assistant_message_id,
                        "text": chunk.text,
                    },
                )
                sequence += 1
        message, log, revision = await _settle(
            prepared,
            content=content,
            status="completed",
            error_message=None,
            trace_id=trace_id,
            started=started,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
        )
        yield _event(
            "done",
            sequence,
            {
                "message": message_out(message).model_dump(mode="json"),
                "log_id": log.id,
                "trace_id": trace_id,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": total_tokens,
                "latency_ms": log.latency_ms,
                "revision": revision,
            },
        )
    except asyncio.CancelledError:
        await asyncio.shield(
            _settle(
                prepared,
                content=content,
                status="cancelled",
                error_message="用户停止生成",
                trace_id=trace_id,
                started=started,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=total_tokens,
            )
        )
        raise
    except Exception as exc:
        timeout = isinstance(exc, httpx.TimeoutException)
        message_text = "模型调用超时" if timeout else "模型调用失败"
        message, log, revision = await _settle(
            prepared,
            content=content,
            status="error",
            error_message=f"{message_text}：{str(exc)[:1000]}",
            trace_id=trace_id,
            started=started,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
        )
        yield _event(
            "error",
            sequence,
            {
                "code": "model_timeout" if timeout else "model_call_failed",
                "message": message_text,
                "detail": str(exc)[:1000],
                "message_state": message_out(message).model_dump(mode="json"),
                "log_id": log.id,
                "trace_id": trace_id,
                "revision": revision,
            },
        )
