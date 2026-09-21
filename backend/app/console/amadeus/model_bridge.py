"""Stream Pi model turns through the configured FPL provider boundary."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from time import monotonic
from uuid import uuid4

from app.capabilities.agents.harness.contracts import AgentMessage, ToolCall, ToolSpec
from app.console.amadeus.schemas import ModelTurnIn
from app.llm.call_logs.credentials import CredentialSnapshot
from app.llm.inference.catalog import get_model
from app.llm.models import LlmCallLog
from app.llm.providers.agent import HttpAgentAdapter
from app.runtime.credentials import decrypt_secret
from app.runtime.db import SessionLocal


async def stream_model_turn(
    session,
    workspace_id: str,
    body: ModelTurnIn,
    credential: CredentialSnapshot | None = None,
) -> AsyncIterator[str]:
    model, provider = await get_model(session, workspace_id, body.model_id, "text")
    # Snapshot ORM scalars before releasing the request session; rollback expires
    # instances, and lazy loads from the generator finally-block raise MissingGreenlet.
    slug = model.slug
    provider_kind = provider.kind
    adapter = HttpAgentAdapter(
        kind=provider_kind,
        base_url=provider.base_url,
        api_key=decrypt_secret(provider.api_key_ciphertext),
    )
    messages = [
        AgentMessage(
            role=str(item.get("role", "")),
            text=str(item.get("text", "")),
            tool_call_id=str(item.get("tool_call_id", "")),
            tool_name=str(item.get("tool_name", "")),
            tool_calls=tuple(
                ToolCall(
                    id=str(call.get("id", "")),
                    name=str(call.get("name", "")),
                    arguments=call.get("arguments", {}),
                )
                for call in item.get("tool_calls", [])
            ),
        )
        for item in body.messages
    ]
    tools = [
        ToolSpec(
            name=str(item.get("name", "")),
            description=str(item.get("description", "")),
            parameters_schema=item.get("parameters_schema", {}),
        )
        for item in body.tools
    ]
    await session.rollback()
    started = monotonic()
    log_id = str(uuid4())
    text = ""
    calls: list[dict] = []
    usage: dict[str, int | None] = {}
    error: str | None = None
    success = False
    try:
        async for event in adapter.stream_turn(
            system=body.system,
            messages=messages,
            tools=tools,
            model=slug,
            temperature=0.7,
            max_tokens=4096,
            round_index=0,
        ):
            if hasattr(event, "text"):
                text += event.text
                yield json.dumps({"type": "delta", "text": event.text}, ensure_ascii=False) + "\n"
            if hasattr(event, "tool_calls"):
                calls = [
                    {"id": call.id, "name": call.name, "arguments": call.arguments}
                    for call in event.tool_calls
                ]
                usage = {
                    "prompt_tokens": event.usage.prompt_tokens,
                    "completion_tokens": event.usage.completion_tokens,
                    "total_tokens": event.usage.total_tokens,
                }
                success = True
                yield (
                    json.dumps(
                        {
                            "type": "end",
                            "tool_calls": calls,
                            "usage": usage,
                            "log_id": log_id,
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                )
    except (asyncio.CancelledError, GeneratorExit):
        error = "客户端断开，Amadeus 模型调用已停止"
        raise
    except Exception:
        error = "Amadeus 模型调用失败"
        raise
    finally:
        snapshot = credential or CredentialSnapshot()

        async def settle() -> None:
            async with SessionLocal() as log_session:
                log_session.add(
                    LlmCallLog(
                        id=log_id,
                        workspace_id=workspace_id,
                        call_source="amadeus",
                        provider_kind=provider_kind,
                        model=slug,
                        trace_id=body.run_id or log_id,
                        request_payload=body.model_dump(mode="json"),
                        response_payload={"text": text, "tool_calls": calls},
                        latency_ms=int((monotonic() - started) * 1000),
                        status="success" if success else "error",
                        error_message=error,
                        **usage,
                        **snapshot.as_kwargs(),
                    )
                )
                await log_session.commit()

        # Settlement must never replace a successful end event or the upstream error.
        try:
            await asyncio.shield(settle())
        except Exception:
            pass
