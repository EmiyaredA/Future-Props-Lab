from __future__ import annotations

import time
from uuid import uuid4

import httpx
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.call_logs.credentials import CredentialSnapshot
from app.llm.catalog.service import ModelCatalogService, ResourceNotFoundError
from app.llm.models import LlmCallLog, ModelProvider
from app.llm.providers import invoke_diagnostic
from app.llm.schemas.model_service import TestModelOut
from app.runtime.credentials import decrypt_secret


class DiagnosticCallError(Exception):
    def __init__(self, *, status_code: int, message: str, log_id: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.log_id = log_id


def _redact(value):
    if isinstance(value, dict):
        return {
            key: (
                "[REDACTED]"
                if key.lower() in {"api_key", "authorization", "x-api-key"}
                else _redact(item)
            )
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact(item) for item in value]
    return value


async def test_model(
    session: AsyncSession, model_id: str, credential: CredentialSnapshot | None = None
) -> TestModelOut:
    catalog = ModelCatalogService(session)
    model = await catalog.get_model(model_id)
    provider = await session.get(ModelProvider, model.provider_id)
    if provider is None:
        raise ResourceNotFoundError("供应商不存在")
    if not provider.enabled or not model.enabled:
        raise DiagnosticCallError(status_code=409, message="供应商或模型尚未启用", log_id="")
    if "chat" not in list(model.capabilities or []):
        raise DiagnosticCallError(
            status_code=409,
            message="请在模型测试的语音合成中提供参考录音"
            if provider.kind == "local_qwen_tts"
            else "生成模型请在视觉创作工坊中使用",
            log_id="",
        )
    key = decrypt_secret(provider.api_key_ciphertext) if provider.api_key_ciphertext else ""
    snap = credential or CredentialSnapshot()
    trace_id = str(uuid4())
    log = LlmCallLog(
        call_source="model_diagnostic",
        provider_kind=provider.kind,
        model=model.slug,
        trace_id=trace_id,
        request_payload={
            "model": model.slug,
            "messages": [{"role": "user", "content": "Reply with exactly OK."}],
            "max_tokens": 16,
        },
        response_payload={},
        status="error",
        **snap.as_kwargs(),
    )
    started = time.monotonic()
    try:
        result = await invoke_diagnostic(
            kind=provider.kind,
            base_url=provider.base_url,
            api_key=key,
            model=model.slug,
        )
        log.response_payload = _redact(result.response_payload)
        log.prompt_tokens = result.prompt_tokens
        log.completion_tokens = result.completion_tokens
        log.total_tokens = result.total_tokens
        log.status = "success"
        log.latency_ms = max(0, round((time.monotonic() - started) * 1000))
        session.add(log)
        await session.commit()
        return TestModelOut(ok=True, log_id=log.id, output=result.output, latency_ms=log.latency_ms)
    except OperationalError:
        await session.rollback()
        raise
    except Exception as exc:
        log.latency_ms = max(0, round((time.monotonic() - started) * 1000))
        log.error_message = str(exc)[:4000]
        log.response_payload = {
            "error": type(exc).__name__,
            "message": str(exc)[:2000],
        }
        session.add(log)
        await session.commit()
        status_code = 504 if isinstance(exc, httpx.TimeoutException) else 502
        message = "模型测试调用超时" if status_code == 504 else "模型测试调用失败"
        raise DiagnosticCallError(
            status_code=status_code,
            message=message,
            log_id=log.id,
        ) from exc
