"""Run one frozen Galgame provider attempt and retain its outcome in Models."""

import time

from cryptography.fernet import InvalidToken
from sqlalchemy import select, text, update

from app.runtime.credentials import decrypt_secret
from studio.apps.model_service.catalog.transcription import supports_asr
from studio.apps.model_service.providers.transcription import transcribe_model_audio
from studio.apps.model_service.storage.models.call_log import LlmCallLog
from studio.apps.model_service.storage.models.model_service import ModelEntry, ModelProvider
from studio.apps.model_service.storage.service_models import GalgameTranscriptionAttempt
from studio.apps.model_service.transcription.support import (
    max_transcription_input_bytes,
    safe_transcription_error,
)
from studio.contracts.galgame_workshop.galgame_asr_execution import AsrOutcome, TranscriptSegment
from studio.contracts.model_service.credential_snapshot import snapshot_from_actor
from studio.runtime.ids import new_id
from studio.runtime.project_errors import ProjectResourceError

UNKNOWN = "语音识别提交结果未知，请核对供应商后重新创建任务"


def outcome(row, fingerprint):
    if row.fingerprint != fingerprint:
        raise ProjectResourceError("语音识别任务描述已变化", "asr_attempt_conflict", 409)
    if row.outcome is not None:
        return AsrOutcome.model_validate(row.outcome)
    return AsrOutcome(status=row.status)


async def recover_transcription_attempts(sessions):
    async with sessions(info={"allow_system_reads": True}) as db:
        interrupted = list(
            await db.execute(
                select(
                    GalgameTranscriptionAttempt.owner_user_id, GalgameTranscriptionAttempt.task_id
                ).where(GalgameTranscriptionAttempt.status == "running")
            )
        )
    for owner, task_id in interrupted:
        async with sessions(info={"owner_user_id": owner}) as db:
            await db.execute(
                update(GalgameTranscriptionAttempt)
                .where(
                    GalgameTranscriptionAttempt.task_id == task_id,
                    GalgameTranscriptionAttempt.status == "running",
                )
                .values(
                    status="unknown",
                    outcome=AsrOutcome(status="unknown", error=UNKNOWN).model_dump(mode="json"),
                )
            )
            await db.commit()


class GalgameTranscription:
    def __init__(self, sessions):
        self.sessions = sessions

    async def read(self, owner, identity, fingerprint):
        async with self.sessions(info={"owner_user_id": owner}) as db:
            row = await db.get(GalgameTranscriptionAttempt, (owner, identity))
            return outcome(row, fingerprint) if row is not None else None

    async def execute(self, actor, body, fingerprint, audio, provider_options):
        owner = actor.user_id
        key = owner, body.task_id
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            if previous := await db.get(GalgameTranscriptionAttempt, key):
                return outcome(previous, fingerprint)
            model = await db.get(ModelEntry, body.model_id)
            provider = await db.get(ModelProvider, body.provider_id)
            if (
                model is None
                or provider is None
                or model.provider_id != provider.id
                or model.slug != body.model_slug
                or not supports_asr(model, provider)
            ):
                raise ProjectResourceError(
                    "语音识别模型或供应商已变化", "asr_model_unavailable", 409
                )
            if not provider.api_key_ciphertext:
                raise ProjectResourceError(
                    "供应商缺少 API Key", "asr_model_credentials_missing", 409
                )
            if body.byte_size > max_transcription_input_bytes(provider):
                raise ProjectResourceError(
                    "语音识别原件超过模型大小限制", "asr_input_too_large", 413
                )
            try:
                api_key = decrypt_secret(provider.api_key_ciphertext)
            except (InvalidToken, ValueError) as exc:
                raise ProjectResourceError(
                    "供应商 API Key 不可用", "asr_model_credentials_invalid", 409
                ) from exc
            kind, url = provider.kind, provider.base_url
            options = provider_options(url)
            db.add(
                GalgameTranscriptionAttempt(
                    owner_user_id=owner, task_id=body.task_id, fingerprint=fingerprint
                )
            )
            await db.commit()
        started = time.perf_counter()
        try:
            result = await transcribe_model_audio(
                provider_kind=kind,
                base_url=url,
                api_key=api_key,
                model=body.model_slug,
                filename=body.filename,
                source=audio,
                mime_type=body.mime_type,
                byte_size=body.byte_size,
                language=body.language,
                **options,
            )
            final = AsrOutcome(
                status="completed",
                text=result.text,
                segments=[
                    TranscriptSegment(
                        speaker=item.speaker,
                        startMs=item.start_ms,
                        endMs=item.end_ms,
                        text=item.text,
                    )
                    for item in result.segments
                ],
            )
        except Exception as exc:
            final = AsrOutcome(status="failed", error=safe_transcription_error(exc))
        async with self.sessions(info={"owner_user_id": owner}) as db:
            row = await db.get(GalgameTranscriptionAttempt, key)
            row.status, row.outcome = final.status, final.model_dump(mode="json")
            db.add(
                LlmCallLog(
                    id=new_id(),
                    owner_user_id=owner,
                    call_source="model_inference",
                    provider_kind=kind,
                    model=body.model_slug,
                    trace_id=body.task_id,
                    request_payload={
                        "application": "galgame-workshop",
                        "project_id": body.project_id,
                        "asset_id": body.asset_id,
                        "language": body.language,
                        "attachments": [
                            {
                                "filename": body.filename,
                                "mime_type": body.mime_type,
                                "byte_size": body.byte_size,
                            }
                        ],
                    },
                    response_payload={"status": final.status, "content": final.text},
                    latency_ms=max(0, round((time.perf_counter() - started) * 1000)),
                    status="success" if final.status == "completed" else "error",
                    error_message=final.error,
                    **snapshot_from_actor(actor).as_kwargs(),
                )
            )
            await db.commit()
        return final
