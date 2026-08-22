from __future__ import annotations

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import httpx

from app.agents.harness.contracts import ImageInput
from app.core.outbound_urls import require_safe_provider_base_url


@dataclass(frozen=True)
class TextDelta:
    text: str = ""
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    finish_reason: str | None = None


@dataclass(frozen=True)
class ChatMessageInput:
    role: str
    text: str
    images: tuple[ImageInput, ...] = ()


def _integer(value: Any) -> int | None:
    return int(value) if isinstance(value, int) else None


async def _data_lines(response: httpx.Response) -> AsyncIterator[dict[str, Any]]:
    async for line in response.aiter_lines():
        if not line.startswith("data:"):
            continue
        raw = line[5:].strip()
        if not raw or raw == "[DONE]":
            continue
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            yield payload


async def stream_text_completion(
    *,
    kind: str,
    base_url: str,
    api_key: str,
    model: str,
    system_prompt: str,
    messages: list[ChatMessageInput],
    temperature: float,
    max_tokens: int,
    transport: httpx.AsyncBaseTransport | None = None,
) -> AsyncIterator[TextDelta]:
    base_url = require_safe_provider_base_url(base_url)
    timeout = httpx.Timeout(120.0, connect=15.0)
    async with httpx.AsyncClient(timeout=timeout, transport=transport) as client:
        if kind == "openai":
            root = base_url or "https://api.openai.com/v1"
            headers = {"Content-Type": "application/json"}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"
            request_messages: list[dict[str, Any]] = []
            for message in messages:
                if not message.images:
                    request_messages.append({"role": message.role, "content": message.text})
                    continue
                content: list[dict[str, Any]] = [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{image.mime_type};base64,{image.data_base64}",
                            "detail": "auto",
                        },
                    }
                    for image in message.images
                ]
                if message.text:
                    content.append({"type": "text", "text": message.text})
                request_messages.append({"role": message.role, "content": content})
            if system_prompt:
                request_messages.insert(0, {"role": "system", "content": system_prompt})
            async with client.stream(
                "POST",
                f"{root.rstrip('/')}/chat/completions",
                headers=headers,
                json={
                    "model": model,
                    "messages": request_messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                    "stream": True,
                    "stream_options": {"include_usage": True},
                },
            ) as response:
                response.raise_for_status()
                async for payload in _data_lines(response):
                    choices = payload.get("choices") or []
                    text = ""
                    finish_reason: str | None = None
                    if choices and isinstance(choices[0], dict):
                        delta = choices[0].get("delta") or {}
                        if isinstance(delta, dict):
                            text = str(delta.get("content") or "")
                        raw_finish_reason = choices[0].get("finish_reason")
                        if raw_finish_reason:
                            finish_reason = str(raw_finish_reason)
                    usage = payload.get("usage") or {}
                    yield TextDelta(
                        text=text,
                        prompt_tokens=_integer(usage.get("prompt_tokens")),
                        completion_tokens=_integer(usage.get("completion_tokens")),
                        total_tokens=_integer(usage.get("total_tokens")),
                        finish_reason=finish_reason,
                    )
            return

        root = base_url or "https://api.anthropic.com/v1"
        headers = {
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        }
        request_messages: list[dict[str, Any]] = []
        for message in messages:
            if not message.images:
                request_messages.append({"role": message.role, "content": message.text})
                continue
            content: list[dict[str, Any]] = [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": image.mime_type,
                        "data": image.data_base64,
                    },
                }
                for image in message.images
            ]
            if message.text:
                content.append({"type": "text", "text": message.text})
            request_messages.append({"role": message.role, "content": content})
        body: dict[str, Any] = {
            "model": model,
            "messages": request_messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }
        if system_prompt:
            body["system"] = system_prompt
        prompt_tokens: int | None = None
        completion_tokens: int | None = None
        finish_reason: str | None = None
        async with client.stream(
            "POST",
            f"{root.rstrip('/')}/messages",
            headers=headers,
            json=body,
        ) as response:
            response.raise_for_status()
            async for payload in _data_lines(response):
                event_type = payload.get("type")
                text = ""
                if event_type == "content_block_delta":
                    delta = payload.get("delta") or {}
                    if isinstance(delta, dict) and delta.get("type") == "text_delta":
                        text = str(delta.get("text") or "")
                if event_type == "message_start":
                    usage = (payload.get("message") or {}).get("usage") or {}
                    prompt_tokens = _integer(usage.get("input_tokens")) or prompt_tokens
                if event_type == "message_delta":
                    usage = payload.get("usage") or {}
                    completion_tokens = _integer(usage.get("output_tokens")) or completion_tokens
                    delta = payload.get("delta") or {}
                    raw_finish_reason = (
                        delta.get("stop_reason") if isinstance(delta, dict) else None
                    )
                    if raw_finish_reason:
                        finish_reason = str(raw_finish_reason)
                total = (
                    prompt_tokens + completion_tokens
                    if prompt_tokens is not None and completion_tokens is not None
                    else None
                )
                yield TextDelta(
                    text=text,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    total_tokens=total,
                    finish_reason=finish_reason,
                )
