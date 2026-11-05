from __future__ import annotations

import asyncio
from pathlib import Path
from uuid import uuid4

import httpx
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.runtime.credentials import decrypt_secret
from studio.apps.model_service.call_logs.record_attribution import snapshot_from_row
from studio.apps.model_service.generation.outcomes import TaskClaimRejected
from studio.apps.model_service.providers.transcription import transcribe_model_audio
from studio.apps.model_service.storage.models.call_log import LlmCallLog
from studio.apps.model_service.storage.models.model_service import ModelEntry, ModelProvider
from studio.apps.model_service.storage.models.model_test import ModelTestTranscriptionTask
from studio.apps.model_service.transcription.support import (
    model_supports_transcription,
    safe_transcription_error,
)
from studio.config.settings import Settings, get_settings
from studio.contracts.model_service.schemas.model_test import ModelTestTranscriptionResultDetailOut
from studio.runtime.database.task_records import load_runner_task, recovery_accounts
from studio.runtime.tasks.polling import PollingTaskRunner
from studio.runtime.time import utc_now


class ModelTestTranscriptionRunner(PollingTaskRunner):
    runner_name = "model-test-transcription-runner"

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        settings: Settings | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        *,
        prepare_claim=None,
        terminal_settlement=None,
    ) -> None:
        super().__init__()
        self.session_factory = session_factory
        self.settings = settings or get_settings()
        self.transport = transport
        self.prepare_claim, self.terminal_settlement = prepare_claim, terminal_settlement

    async def _load_task(
        self, session: AsyncSession, task_id: str
    ) -> ModelTestTranscriptionTask | None:
        return await load_runner_task(
            session, ModelTestTranscriptionTask, task_id, subject="transcription task"
        )

    async def recover(self) -> None:
        owners = await recovery_accounts(
            self.session_factory, ModelTestTranscriptionTask, statuses=("running",)
        )
        for owner in owners:
            async with self.session_factory(info={"owner_user_id": owner}) as session:
                rows = list(
                    await session.scalars(
                        select(ModelTestTranscriptionTask).where(
                            ModelTestTranscriptionTask.owner_user_id == owner,
                            ModelTestTranscriptionTask.status == "running",
                        )
                    )
                )
                for row in rows:
                    row.status = "failed"
                    row.error_message = "应用在识别请求期间中断；为避免重复计费，请重新开始测试"
                    row.completed_at = utc_now()
                    row.updated_at = row.completed_at
                    row.revision += 1
                    await self._on_terminal(session, row)
                await session.commit()

    async def process_once(self) -> None:
        async with self.session_factory(info={"allow_system_reads": True}) as session:
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
                parameters,
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
                    parameters=parameters,
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
                        "translation": segment.translation,
                        "speaker_candidates": list(segment.speaker_candidates),
                        "is_overlap": segment.is_overlap,
                    }
                    for segment in result.segments
                ]
                row.result_detail = ModelTestTranscriptionResultDetailOut.model_validate(
                    {
                        **dict(result.detail or {}),
                        "words": [
                            {
                                "word": word.word,
                                "start_ms": word.start_ms,
                                "end_ms": word.end_ms,
                            }
                            for word in result.words
                        ],
                    }
                ).model_dump(mode="json")
                row.error_message = None
                row.completed_at = utc_now()
                row.updated_at = row.completed_at
                row.revision += 1
                await self._on_terminal(session, row)
                await session.commit()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await self._fail(task_id, safe_transcription_error(exc))

    async def _prepare(
        self, task_id: str
    ) -> tuple[str, str, str, str, str, Path, str, int, str, dict[str, object]] | None:
        prepared = await self.prepare_claim(task_id) if self.prepare_claim else None
        if self.prepare_claim is not None and prepared is None:
            return None
        async with self.session_factory() as session:
            if prepared is not None:
                await session.execute(text("BEGIN IMMEDIATE"))
            row = await self._load_task(session, task_id)
            if row is None or row.status != "queued":
                return None
            if prepared is not None:
                try:
                    allowed = await prepared(session, row)
                except TaskClaimRejected as exc:
                    row.status, row.error_message = "failed", str(exc)[:4000]
                    row.completed_at = utc_now()
                    row.updated_at = row.completed_at
                    row.revision += 1
                    await self._on_terminal(session, row)
                    await session.commit()
                    return None
                if not allowed:
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
                self.settings.account_model_test_path(row.owner_user_id, "references")
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
                dict(row.request_options or {}),
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
            await self._on_terminal(session, row)
            await session.commit()

    async def _on_terminal(self, session, row):
        self._add_log(session, row)
        if self.terminal_settlement:
            await self.terminal_settlement(session)

    def _add_log(self, session: AsyncSession, row: ModelTestTranscriptionTask) -> None:
        if row.log_id:
            return
        finished_at = row.completed_at or utc_now()
        started_at = row.started_at or row.created_at
        log_id = str(uuid4())
        session.add(
            LlmCallLog(
                id=log_id,
                owner_user_id=row.owner_user_id,
                call_source="model_playground",
                provider_kind=row.provider_kind,
                model=row.model_slug,
                trace_id=str(uuid4()),
                request_payload={
                    "model": row.model_slug,
                    "language": row.language,
                    "parameters": dict(row.request_options or {}),
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
                    "detail": dict(row.result_detail or {}),
                },
                latency_ms=max(0, round((finished_at - started_at).total_seconds() * 1000)),
                status="success" if row.status == "completed" else "error",
                error_message=row.error_message,
                **snapshot_from_row(row).as_kwargs(),
            )
        )
        row.log_id = log_id
