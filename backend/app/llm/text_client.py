"""Provider-neutral text entrypoint for product features outside model testing."""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.call_logs.credentials import CredentialSnapshot
from app.llm.inference.catalog import get_model
from app.llm.models import LlmCallLog
from app.llm.providers.streaming import ChatMessageInput, TextDelta, stream_text_completion
from app.runtime.credentials import decrypt_secret


@dataclass(frozen=True)
class TextModel:
    kind: str
    base_url: str
    api_key: str
    slug: str


async def resolve_text_model(session: AsyncSession, workspace_id: str, model_id: str) -> TextModel:
    model, provider = await get_model(session, workspace_id, model_id, "text")
    return TextModel(
        kind=provider.kind,
        base_url=provider.base_url,
        api_key=decrypt_secret(provider.api_key_ciphertext),
        slug=model.slug,
    )


async def stream_product_text(
    model: TextModel, *, system_prompt: str, messages: list[ChatMessageInput]
) -> AsyncIterator[TextDelta]:
    async for delta in stream_text_completion(
        kind=model.kind,
        base_url=model.base_url,
        api_key=model.api_key,
        model=model.slug,
        system_prompt=system_prompt,
        messages=messages,
        temperature=0.7,
        max_tokens=512,
    ):
        yield delta


def add_product_text_log(
    session: AsyncSession,
    *,
    workspace_id: str,
    call_source: str,
    model: TextModel,
    trace_id: str,
    credential: CredentialSnapshot,
    request_payload: dict,
    response_payload: dict,
    usage: dict[str, int],
    latency_ms: int,
    success: bool,
    error_message: str | None,
) -> None:
    session.add(
        LlmCallLog(
            workspace_id=workspace_id,
            call_source=call_source,
            provider_kind=model.kind,
            model=model.slug,
            trace_id=trace_id,
            request_payload=request_payload,
            response_payload=response_payload,
            latency_ms=latency_ms,
            status="success" if success else "error",
            error_message=error_message,
            **usage,
            **credential.as_kwargs(),
        )
    )
