from __future__ import annotations

import asyncio
from pathlib import Path
from uuid import uuid4

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings, get_settings
from app.core.credentials import decrypt_secret
from app.core.db import SessionLocal
from app.core.tenant_context import bind_workspace
from app.core.time import utc_now
from app.llm.generation_runtime import PollingGenerationRunner
from app.llm.playground.transcription import model_supports_transcription
from app.llm.providers._senseaudio import SenseAudioProviderError
from app.llm.providers.senseaudio_asr import SenseAudioAsrFileTooLarge
from app.llm.providers.transcription import transcribe_model_audio
from app.models import LlmCallLog, ModelEntry, ModelProvider, ModelTestTranscriptionTask


def _safe_error(exc: Exception) -> str:
    if isinstance(exc, SenseAudioAsrFileTooLarge):
        return str(exc)
    if isinstance(exc, httpx.TimeoutException):
        return "语音识别请求超时"
    if isinstance(exc, SenseAudioProviderError):
        return str(exc)[:4000]
    if isinstance(exc, httpx.HTTPStatusError):
        return f"语音识别供应商返回错误（HTTP {exc.response.status_code}）"
    if isinstance(exc, ValueError):
        return str(exc)[:4000]
    return f"语音识别失败（{type(exc).__name__}）"


class ModelTestTranscriptionRunner(PollingGenerationRunner):
    runner_name = "model-test-transcription-runner"

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession] = SessionLocal,
        settings: Settings | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        super().__init__()
        self.session_factory = session_factory
        self.settings = settings or get_settings()
        self.transport = transport

    async def _load_task(
        self, session: AsyncSession, task_id: str
    ) -> ModelTestTranscriptionTask | None:
        task = await session.get(ModelTestTranscriptionTask, task_id)
        if task is not None:
            bind_workspace(session, task.workspace_id)
        return task

    async def recover(self) -> None:
        async with self.session_factory() as session:
            rows = list(
                (
                    await session.execute(
                        select(ModelTestTranscriptionTask).where(
                            ModelTestTranscriptionTask.status == "running"
                        )
                    )
                )
                .scalars()
                .all()
            )
            for row in rows:
                row.status = "failed"
                row.error_message = "应用在识别请求期间中断；为避免重复计费，请重新开始测试"
                row.completed_at = utc_now()
                row.updated_at = row.completed_at
                row.revision += 1
                self._add_log(session, row)
            await session.commit()

    async def process_once(self) -> None:
        async with self.session_factory() as session:
            task_ids = list(
                (
                    await session.execute(
                        select(ModelTestTranscriptionTask.id)
                        .where(ModelTestTranscriptionTask.status == "queued")
                        .order_by(ModelTestTranscriptionTask.created_at)
                        .limit(40)
                    )
                )
                .scalars()
                .all()
            )
        await self.run_concurrently(task_ids, self._process_task)

    async def _process_task(self, task_id: str) -> None:
        try:
            prepared = await self._prepare(task_id)
            if prepared is None:
                return
            (
                provider_kind,
                base_url,
                api_key,
                model_slug,
                filename,
                path,
                mime_type,
                byte_size,
                language,
            ) = prepared
            with path.open("rb") as source:
                result = await transcribe_model_audio(
                    provider_kind=provider_kind,
                    base_url=base_url,
                    api_key=api_key,
                    model=model_slug,
                    filename=filename,
                    source=source,
                    mime_type=mime_type,
                    byte_size=byte_size,
                    language=language,
                    transport=self.transport,
                )
            async with self.session_factory() as session:
                row = await self._load_task(session, task_id)
                if row is None or row.status != "running":
                    return
                row.status = "completed"
                row.result_text = result.text.strip()
                row.result_segments = [
                    {
                        "speaker": segment.speaker,
                        "start_ms": segment.start_ms,
                        "end_ms": segment.end_ms,
                        "text": segment.text,
                    }
                    for segment in result.segments
                ]
                row.error_message = None
                row.completed_at = utc_now()
                row.updated_at = row.completed_at
                row.revision += 1
                self._add_log(session, row)
                await session.commit()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await self._fail(task_id, _safe_error(exc))

    async def _prepare(
        self, task_id: str
    ) -> tuple[str, str, str, str, str, Path, str, int, str] | None:
        async with self.session_factory() as session:
            row = await self._load_task(session, task_id)
            if row is None or row.status != "queued":
                return None
            model = await session.get(ModelEntry, row.model_id) if row.model_id else None
            provider = (
                await session.get(ModelProvider, row.provider_id) if row.provider_id else None
            )
            if (
                model is None
                or provider is None
                or provider.kind != row.provider_kind
                or model.slug != row.model_slug
                or not model_supports_transcription(model, provider)
            ):
                await session.rollback()
                await self._fail(task_id, "供应商或模型已停用、删除或不再支持语音识别")
                return None
            if not provider.api_key_ciphertext:
                await session.rollback()
                await self._fail(task_id, "供应商缺少 API Key")
                return None
            path = (
                self.settings.workspace_model_test_path(row.workspace_id, "references")
                / row.input_storage_key
            )
            if not path.is_file():
                await session.rollback()
                await self._fail(task_id, "输入音频已不存在")
                return None
            row.status = "running"
            row.started_at = utc_now()
            row.updated_at = row.started_at
            row.revision += 1
            prepared = (
                provider.kind,
                provider.base_url,
                decrypt_secret(provider.api_key_ciphertext),
                row.model_slug,
                row.input_filename,
                path,
                row.input_mime_type,
                row.input_byte_size,
                row.language,
            )
            await session.commit()
            return prepared

    async def _fail(self, task_id: str, message: str) -> None:
        async with self.session_factory() as session:
            row = await self._load_task(session, task_id)
            if row is None or row.status in {"completed", "failed"}:
                return
            row.status = "failed"
            row.error_message = message[:4000]
            row.completed_at = utc_now()
            row.updated_at = row.completed_at
            row.revision += 1
            self._add_log(session, row)
            await session.commit()

    def _add_log(self, session: AsyncSession, row: ModelTestTranscriptionTask) -> None:
        if row.log_id:
            return
        finished_at = row.completed_at or utc_now()
        started_at = row.started_at or row.created_at
        log_id = str(uuid4())
        session.add(
            LlmCallLog(
                id=log_id,
                workspace_id=row.workspace_id,
                call_source="model_playground",
                provider_kind=row.provider_kind,
                model=row.model_slug,
                trace_id=str(uuid4()),
                request_payload={
                    "model": row.model_slug,
                    "language": row.language,
                    "messages": [
                        {
                            "role": "user",
                            "content": "语音识别",
                            "attachments": [
                                {
                                    "filename": row.input_filename,
                                    "mime_type": row.input_mime_type,
                                    "byte_size": row.input_byte_size,
                                }
                            ],
                        }
                    ],
                },
                response_payload={
                    "status": row.status,
                    "content": row.result_text or "",
                    "segments": list(row.result_segments or []),
                },
                latency_ms=max(0, round((finished_at - started_at).total_seconds() * 1000)),
                status="success" if row.status == "completed" else "error",
                error_message=row.error_message,
            )
        )
        row.log_id = log_id
