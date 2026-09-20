"""Stream Pi model turns through the configured FPL provider boundary."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

from app.capabilities.agents.harness.contracts import AgentMessage, ToolCall, ToolSpec
from app.console.amadeus.schemas import ModelTurnIn
from app.llm.inference.catalog import get_model
from app.llm.providers.agent import HttpAgentAdapter
from app.runtime.credentials import decrypt_secret


async def stream_model_turn(session, workspace_id: str, body: ModelTurnIn) -> AsyncIterator[str]:
    model, provider = await get_model(session, workspace_id, body.model_id, "text")
    slug = model.slug
    adapter = HttpAgentAdapter(
        kind=provider.kind,
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
            yield json.dumps({"type": "delta", "text": event.text}, ensure_ascii=False) + "\n"
        if hasattr(event, "tool_calls"):
            yield (
                json.dumps(
                    {
                        "type": "end",
                        "tool_calls": [
                            {"id": call.id, "name": call.name, "arguments": call.arguments}
                            for call in event.tool_calls
                        ],
                        "usage": {
                            "prompt_tokens": event.usage.prompt_tokens,
                            "completion_tokens": event.usage.completion_tokens,
                            "total_tokens": event.usage.total_tokens,
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
