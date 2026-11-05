from __future__ import annotations

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import httpx

from studio.apps.model_service.providers.chat_completions import (
    OPENAI_CHAT_KINDS,
    chat_base_url,
    chat_request_options,
)
from studio.contracts.agent_runtime.dialogue import ImageInput
from studio.runtime.http.outbound_urls import require_safe_provider_base_url


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


class ProviderStreamError(Exception):
    """A provider-neutral failure safe to expose in logs and SSE details."""


async def _data_lines(response: httpx.Response) -> AsyncIterator[dict[str, Any]]:
    data: list[str] = []
    event = ""

    def parse() -> dict[str, Any]:
        raw = "\n".join(data)
        if raw.strip() == "[DONE]":
            return {"type": "_stream_done"}
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ProviderStreamError("模型返回了无效的流式响应") from exc
        if not isinstance(payload, dict):
            raise ProviderStreamError("模型返回了无效的流式响应")
        if event == "error":
            raise ProviderStreamError("模型流式调用失败")
        return payload

    async for line in response.aiter_lines():
        if not line:
            if data:
                yield parse()
            data = []
            event = ""
        elif line.startswith("data:"):
            data.append(line[5:].removeprefix(" "))
        elif line.startswith("event:"):
            event = line[6:].strip()
    if data:
        yield parse()


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
        if kind in OPENAI_CHAT_KINDS:
            root = chat_base_url(kind, base_url)
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
                    **chat_request_options(kind),
                    "model": model,
                    "messages": request_messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                    "stream": True,
                    "stream_options": {"include_usage": True},
                },
            ) as response:
                response.raise_for_status()
                completed = False
                async for payload in _data_lines(response):
                    if "error" in payload or payload.get("type") == "error":
                        raise ProviderStreamError("模型流式调用失败")
                    if payload.get("type") == "_stream_done":
                        completed = True
                        break
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
                            completed = True
                    usage = payload.get("usage") or {}
                    yield TextDelta(
                        text=text,
                        prompt_tokens=_integer(usage.get("prompt_tokens")),
                        completion_tokens=_integer(usage.get("completion_tokens")),
                        total_tokens=_integer(usage.get("total_tokens")),
                        finish_reason=finish_reason,
                    )
                if not completed:
                    raise ProviderStreamError("模型流式响应在完成前中断")
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
            completed = False
            async for payload in _data_lines(response):
                if "error" in payload or payload.get("type") == "error":
                    raise ProviderStreamError("模型流式调用失败")
                if payload.get("type") == "message_stop":
                    completed = True
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
                if completed:
                    break

            if not completed:
                raise ProviderStreamError("模型流式响应在完成前中断")
