from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from app.demo_runtime.runtime import mock_transport
from app.runtime.outbound_urls import require_safe_provider_base_url

PROMPT = "Reply with exactly OK."


@dataclass(frozen=True)
class DiagnosticResult:
    output: str
    response_payload: dict[str, Any]
    prompt_tokens: int | None
    completion_tokens: int | None
    total_tokens: int | None


def _integer(value: Any) -> int | None:
    return int(value) if isinstance(value, int) else None


async def invoke_diagnostic(
    *,
    kind: str,
    base_url: str,
    api_key: str,
    model: str,
    transport: httpx.AsyncBaseTransport | None = None,
) -> DiagnosticResult:
    base_url = require_safe_provider_base_url(base_url)
    transport = mock_transport(base_url, transport)
    timeout = httpx.Timeout(30.0)
    async with httpx.AsyncClient(timeout=timeout, transport=transport) as client:
        if kind == "openai":
            root = base_url or "https://api.openai.com/v1"
            headers = {"Content-Type": "application/json"}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"
            response = await client.post(
                f"{root.rstrip('/')}/chat/completions",
                headers=headers,
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": PROMPT}],
                    "max_tokens": 16,
                },
            )
            response.raise_for_status()
            payload = response.json()
            choices = payload.get("choices") or []
            output = str(((choices[0].get("message") or {}).get("content")) if choices else "")
            usage = payload.get("usage") or {}
            return DiagnosticResult(
                output=output,
                response_payload=payload,
                prompt_tokens=_integer(usage.get("prompt_tokens")),
                completion_tokens=_integer(usage.get("completion_tokens")),
                total_tokens=_integer(usage.get("total_tokens")),
            )

        root = base_url or "https://api.anthropic.com/v1"
        response = await client.post(
            f"{root.rstrip('/')}/messages",
            headers={
                "Content-Type": "application/json",
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
            },
            json={
                "model": model,
                "messages": [{"role": "user", "content": PROMPT}],
                "max_tokens": 16,
            },
        )
        response.raise_for_status()
        payload = response.json()
        content = payload.get("content") or []
        output = "".join(str(item.get("text") or "") for item in content if isinstance(item, dict))
        usage = payload.get("usage") or {}
        prompt_tokens = _integer(usage.get("input_tokens"))
        completion_tokens = _integer(usage.get("output_tokens"))
        total = (
            prompt_tokens + completion_tokens
            if prompt_tokens is not None and completion_tokens is not None
            else None
        )
        return DiagnosticResult(
            output=output,
            response_payload=payload,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total,
        )
