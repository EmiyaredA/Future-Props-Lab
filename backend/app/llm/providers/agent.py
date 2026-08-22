from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.agents.harness.contracts import (
    AgentMessage,
    ModelAdapter,
    ModelEvent,
    ModelTextDelta,
    ModelTurnEnd,
    ToolCall,
    ToolSpec,
    Usage,
)
from app.core.outbound_urls import require_safe_provider_base_url
from app.llm.providers.streaming import _data_lines, _integer

__all__ = [
    "AgentMessage",
    "HttpAgentAdapter",
    "ModelAdapter",
    "ModelEvent",
    "ModelTextDelta",
    "ModelTurnEnd",
    "ToolCall",
    "ToolSpec",
    "Usage",
]


class HttpAgentAdapter:
    def __init__(
        self,
        *,
        kind: str,
        base_url: str,
        api_key: str,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.kind = kind
        self.base_url = require_safe_provider_base_url(base_url)
        self.api_key = api_key
        self.transport = transport

    def _openai_messages(self, system: str, messages: list[AgentMessage]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        if system:
            out.append({"role": "system", "content": system})
        for message in messages:
            if message.role == "user" and message.images:
                content: list[dict[str, Any]] = [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{item.mime_type};base64,{item.data_base64}",
                            "detail": "auto",
                        },
                    }
                    for item in message.images
                ]
                if message.text:
                    content.append({"type": "text", "text": message.text})
                out.append({"role": "user", "content": content})
            elif message.role == "assistant" and message.tool_calls:
                out.append(
                    {
                        "role": "assistant",
                        "content": message.text or None,
                        "tool_calls": [
                            {
                                "id": call.id,
                                "type": "function",
                                "function": {
                                    "name": call.name,
                                    "arguments": json.dumps(call.arguments, ensure_ascii=False),
                                },
                            }
                            for call in message.tool_calls
                        ],
                    }
                )
            elif message.role == "tool":
                out.append(
                    {
                        "role": "tool",
                        "tool_call_id": message.tool_call_id,
                        "content": message.text,
                    }
                )
            else:
                out.append({"role": message.role, "content": message.text})
        return out

    def _anthropic_messages(self, messages: list[AgentMessage]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for message in messages:
            if message.role == "user":
                if message.images:
                    content: list[dict[str, Any]] = [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": item.mime_type,
                                "data": item.data_base64,
                            },
                        }
                        for item in message.images
                    ]
                    if message.text:
                        content.append({"type": "text", "text": message.text})
                    out.append({"role": "user", "content": content})
                else:
                    out.append({"role": "user", "content": message.text})
            elif message.role == "assistant":
                blocks: list[dict[str, Any]] = []
                if message.text:
                    blocks.append({"type": "text", "text": message.text})
                blocks.extend(
                    {
                        "type": "tool_use",
                        "id": call.id,
                        "name": call.name,
                        "input": call.arguments,
                    }
                    for call in message.tool_calls
                )
                out.append({"role": "assistant", "content": blocks})
            elif message.role == "tool":
                block = {
                    "type": "tool_result",
                    "tool_use_id": message.tool_call_id,
                    "content": message.text,
                }
                if out and out[-1]["role"] == "user" and isinstance(out[-1]["content"], list):
                    previous = out[-1]["content"]
                    if previous and all(item.get("type") == "tool_result" for item in previous):
                        previous.append(block)
                        continue
                out.append({"role": "user", "content": [block]})
        return out

    async def stream_turn(
        self,
        *,
        system: str,
        messages: list[AgentMessage],
        tools: list[ToolSpec],
        model: str,
        temperature: float,
        max_tokens: int,
        round_index: int,
    ) -> AsyncIterator[ModelEvent]:
        del round_index
        timeout = httpx.Timeout(120.0, connect=15.0)
        async with httpx.AsyncClient(timeout=timeout, transport=self.transport) as client:
            if self.kind == "openai":
                root = self.base_url or "https://api.openai.com/v1"
                headers = {"Content-Type": "application/json"}
                if self.api_key:
                    headers["Authorization"] = f"Bearer {self.api_key}"
                body: dict[str, Any] = {
                    "model": model,
                    "messages": self._openai_messages(system, messages),
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                    "stream": True,
                    "stream_options": {"include_usage": True},
                }
                if tools:
                    body["tools"] = [
                        {
                            "type": "function",
                            "function": {
                                "name": item.name,
                                "description": item.description,
                                "parameters": item.parameters_schema,
                            },
                        }
                        for item in tools
                    ]
                    body["tool_choice"] = "auto"
                calls: dict[int, dict[str, str]] = {}
                usage = Usage()
                async with client.stream(
                    "POST",
                    f"{root.rstrip('/')}/chat/completions",
                    headers=headers,
                    json=body,
                ) as response:
                    response.raise_for_status()
                    async for payload in _data_lines(response):
                        choices = payload.get("choices") or []
                        if choices and isinstance(choices[0], dict):
                            delta = choices[0].get("delta") or {}
                            text = delta.get("content") if isinstance(delta, dict) else ""
                            if text:
                                yield ModelTextDelta(str(text))
                            for raw in delta.get("tool_calls") or []:
                                index = int(raw.get("index") or 0)
                                current = calls.setdefault(
                                    index, {"id": "", "name": "", "arguments": ""}
                                )
                                current["id"] += str(raw.get("id") or "")
                                function = raw.get("function") or {}
                                current["name"] += str(function.get("name") or "")
                                current["arguments"] += str(function.get("arguments") or "")
                        raw_usage = payload.get("usage") or {}
                        if raw_usage:
                            usage = Usage(
                                _integer(raw_usage.get("prompt_tokens")),
                                _integer(raw_usage.get("completion_tokens")),
                                _integer(raw_usage.get("total_tokens")),
                            )
                yield ModelTurnEnd(
                    tuple(
                        ToolCall(
                            id=value["id"] or f"tool-{index}",
                            name=value["name"],
                            arguments=json.loads(value["arguments"] or "{}"),
                        )
                        for index, value in sorted(calls.items())
                    ),
                    usage,
                )
                return

            root = self.base_url or "https://api.anthropic.com/v1"
            body = {
                "model": model,
                "messages": self._anthropic_messages(messages),
                "temperature": temperature,
                "max_tokens": max_tokens,
                "stream": True,
            }
            if system:
                body["system"] = system
            if tools:
                body["tools"] = [
                    {
                        "name": item.name,
                        "description": item.description,
                        "input_schema": item.parameters_schema,
                    }
                    for item in tools
                ]
                body["tool_choice"] = {"type": "auto"}
            blocks: dict[int, dict[str, str]] = {}
            prompt_tokens: int | None = None
            completion_tokens: int | None = None
            async with client.stream(
                "POST",
                f"{root.rstrip('/')}/messages",
                headers={
                    "Content-Type": "application/json",
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                },
                json=body,
            ) as response:
                response.raise_for_status()
                async for payload in _data_lines(response):
                    event_type = payload.get("type")
                    index = int(payload.get("index") or 0)
                    if event_type == "content_block_start":
                        block = payload.get("content_block") or {}
                        if block.get("type") == "tool_use":
                            blocks[index] = {
                                "id": str(block.get("id") or f"tool-{index}"),
                                "name": str(block.get("name") or ""),
                                "arguments": json.dumps(block.get("input") or {}),
                            }
                    elif event_type == "content_block_delta":
                        delta = payload.get("delta") or {}
                        if delta.get("type") == "text_delta" and delta.get("text"):
                            yield ModelTextDelta(str(delta["text"]))
                        elif delta.get("type") == "input_json_delta":
                            current = blocks.setdefault(
                                index,
                                {"id": f"tool-{index}", "name": "", "arguments": ""},
                            )
                            if current["arguments"] == "{}":
                                current["arguments"] = ""
                            current["arguments"] += str(delta.get("partial_json") or "")
                    elif event_type == "message_start":
                        raw_usage = (payload.get("message") or {}).get("usage") or {}
                        prompt_tokens = _integer(raw_usage.get("input_tokens"))
                    elif event_type == "message_delta":
                        raw_usage = payload.get("usage") or {}
                        completion_tokens = _integer(raw_usage.get("output_tokens"))
            total = (
                prompt_tokens + completion_tokens
                if prompt_tokens is not None and completion_tokens is not None
                else None
            )
            yield ModelTurnEnd(
                tuple(
                    ToolCall(
                        id=value["id"],
                        name=value["name"],
                        arguments=json.loads(value["arguments"] or "{}"),
                    )
                    for _index, value in sorted(blocks.items())
                ),
                Usage(prompt_tokens, completion_tokens, total),
            )
