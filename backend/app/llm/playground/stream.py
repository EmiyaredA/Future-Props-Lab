from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator
from uuid import uuid4

import httpx
from sqlalchemy import update

from app.llm.models import LlmCallLog, ModelTestConversation, ModelTestMessage
from app.llm.playground.service import PreparedGeneration, message_out
from app.llm.providers.streaming import stream_text_completion
from app.runtime.credentials import decrypt_secret
from studio.runtime.database.ownership import bind_owner
from studio.runtime.messaging.authorized_stream import authorized_stream
from studio.runtime.time import utc_now


def _event(event_type: str, sequence: int, payload: dict) -> bytes:
    envelope = {
        "type": event_type,
        "schema_version": 2,
        "sequence": sequence,
        "payload": payload,
    }
    return f"data: {json.dumps(envelope, ensure_ascii=False)}\n\n".encode()


async def _settle(
    prepared: PreparedGeneration,
    *,
    session_factory,
    content: str,
    status: str,
    error_message: str | None,
    trace_id: str,
    started: float,
    prompt_tokens: int | None,
    completion_tokens: int | None,
    total_tokens: int | None,
    first_token_latency_ms: int | None,
    finish_reason: str | None,
) -> tuple[ModelTestMessage, LlmCallLog, int]:
    latency_ms = max(0, round((time.monotonic() - started) * 1000))
    async with session_factory() as session:
        bind_owner(session.sync_session, prepared.owner_user_id)
        message = await session.get(ModelTestMessage, prepared.assistant_message_id)
        conversation = await session.get(ModelTestConversation, prepared.conversation_id)
        if message is None or conversation is None:
            raise RuntimeError("模型测试会话已不存在")
        if message.status == "pending":
            message.content = content
            message.status = status
            message.error_message = error_message
            message.updated_at = utc_now()
        result = await session.execute(
            update(ModelTestConversation)
            .where(ModelTestConversation.id == prepared.conversation_id)
            .values(
                revision=ModelTestConversation.revision + 1,
                updated_at=utc_now(),
            )
        )
        if result.rowcount != 1:
            raise RuntimeError("模型测试会话结算失败")
        await session.refresh(conversation)
        log = LlmCallLog(
            owner_user_id=prepared.owner_user_id,
            call_source="model_playground",
            provider_kind=prepared.provider_kind,
            model=prepared.model_slug,
            auth_kind=prepared.auth_kind,
            api_key_id=prepared.api_key_id,
            api_key_name=prepared.api_key_name,
            api_key_prefix=prepared.api_key_prefix,
            trace_id=trace_id,
            request_payload={
                "model": prepared.model_slug,
                "conversation_id": prepared.conversation_id,
                **prepared.request_payload,
            },
            response_payload={
                "content": content,
                "status": status,
                "finish_reason": finish_reason,
                "first_token_latency_ms": first_token_latency_ms,
                "rounds": 1,
            },
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


async def generation_events(
    prepared: PreparedGeneration, *, session_factory, transport_options=None, check_access=None
) -> AsyncIterator[bytes]:
    sequence = 0
    trace_id = str(uuid4())
    started = time.monotonic()
    content = ""
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    first_token_latency_ms: int | None = None
    finish_reason: str | None = None
    yield _event(
        "start",
        sequence,
        {
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
    try:
        key = decrypt_secret(prepared.api_key_ciphertext) if prepared.api_key_ciphertext else ""
        source = stream_text_completion(
            kind=prepared.provider_kind,
            base_url=prepared.base_url,
            api_key=key,
            model=prepared.model_slug,
            system_prompt=prepared.system_prompt,
            messages=prepared.messages,
            temperature=prepared.temperature,
            max_tokens=prepared.max_tokens,
            **(transport_options or {}),
        )
        async for chunk in authorized_stream(source, check_access):
            prompt_tokens = chunk.prompt_tokens or prompt_tokens
            completion_tokens = chunk.completion_tokens or completion_tokens
            total_tokens = chunk.total_tokens or total_tokens
            finish_reason = chunk.finish_reason or finish_reason
            if chunk.text:
                if first_token_latency_ms is None:
                    first_token_latency_ms = max(0, round((time.monotonic() - started) * 1000))
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
            session_factory=session_factory,
            content=content,
            status="completed",
            error_message=None,
            trace_id=trace_id,
            started=started,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            first_token_latency_ms=first_token_latency_ms,
            finish_reason=finish_reason or "stop",
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
                session_factory=session_factory,
                content=content,
                status="cancelled",
                error_message="用户停止生成",
                trace_id=trace_id,
                started=started,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=total_tokens,
                first_token_latency_ms=first_token_latency_ms,
                finish_reason="cancelled",
            )
        )
        raise
    except Exception as exc:
        timeout = isinstance(exc, httpx.TimeoutException)
        message_text = "模型调用超时" if timeout else "模型调用失败"
        message, log, revision = await _settle(
            prepared,
            session_factory=session_factory,
            content=content,
            status="error",
            error_message=f"{message_text}：{str(exc)[:1000]}",
            trace_id=trace_id,
            started=started,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            first_token_latency_ms=first_token_latency_ms,
            finish_reason="error",
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
