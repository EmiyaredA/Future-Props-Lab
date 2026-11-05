from __future__ import annotations

import io
import time
import wave
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.runtime.credentials import decrypt_secret
from studio.apps.model_service.providers.transcription import (
    TranscriptionResult,
    transcribe_model_audio,
)
from studio.apps.model_service.storage.models.call_log import LlmCallLog
from studio.apps.model_service.storage.models.model_service import ModelEntry, ModelProvider
from studio.apps.model_service.transcription.parameters import resolve_parameters
from studio.apps.model_service.transcription.support import (
    max_transcription_input_bytes,
    model_supports_transcription,
    resolve_transcription_language,
    resolve_transcription_target_language,
    safe_transcription_error,
)
from studio.contracts.asset_library.incoming import IncomingFile
from studio.contracts.model_service.annotation import WAV_TYPES, SegmentResult
from studio.contracts.model_service.credential_snapshot import CredentialSnapshot
from studio.contracts.model_service.transcription import ModelTestTranscriptionParametersIn


class AnnotationTranscriptionError(Exception):
    def __init__(self, message, *, code, status=422):
        super().__init__(message)
        self.code, self.status = code, status


_MAX_TEXT_LENGTH = 20_000


def _translated_text(result: TranscriptionResult) -> str:
    if not result.segments:
        raise ValueError("语音识别供应商未返回目标语言译文")
    translations = [(segment.translation or "").strip() for segment in result.segments]
    if any(not text for text in translations):
        raise ValueError("语音识别供应商未返回完整的目标语言译文")
    return "\n".join(translations)


class AnnotationTranscription:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _model(self, model_id: str) -> tuple[ModelEntry, ModelProvider]:
        model = await self.session.get(ModelEntry, model_id)
        provider = (
            await self.session.get(ModelProvider, model.provider_id) if model is not None else None
        )
        if model is None or provider is None or not model_supports_transcription(model, provider):
            raise AnnotationTranscriptionError(
                "当前语音识别模型不可用", code="model_unavailable", status=409
            )
        if not provider.api_key_ciphertext:
            raise AnnotationTranscriptionError(
                "供应商尚未配置 API Key", code="missing_api_key", status=409
            )
        return model, provider

    @staticmethod
    async def _validate_wav(
        upload: IncomingFile,
        *,
        expected_duration_ms: int,
        max_bytes: int,
    ) -> tuple[bytes, int]:
        content_type = (upload.content_type or "application/octet-stream").lower().strip()
        if content_type not in WAV_TYPES:
            raise AnnotationTranscriptionError("片段音频必须为 WAV", code="invalid_segment_audio")
        payload = await upload.read(max_bytes + 1)
        byte_size = len(payload)
        if byte_size <= 0:
            raise AnnotationTranscriptionError("片段音频不能为空", code="empty_segment_audio")
        if byte_size > max_bytes:
            raise AnnotationTranscriptionError(
                f"片段音频不能超过 {max_bytes // (1024 * 1024)} MB",
                code="segment_audio_too_large",
                status=413,
            )
        try:
            with wave.open(io.BytesIO(payload), "rb") as source:
                frame_rate = source.getframerate()
                frame_count = source.getnframes()
                if frame_rate <= 0 or frame_count <= 0 or source.getcomptype() != "NONE":
                    raise wave.Error("unsupported wav")
                duration_ms = round(frame_count / frame_rate * 1000)
        except (EOFError, OSError, wave.Error) as exc:
            raise AnnotationTranscriptionError(
                "片段音频不是有效的 PCM WAV", code="invalid_segment_audio"
            ) from exc
        if abs(duration_ms - expected_duration_ms) > 100:
            raise AnnotationTranscriptionError(
                "片段音频时长与所选范围不一致", code="segment_audio_duration_mismatch"
            )
        return payload, duration_ms

    async def _log(
        self,
        *,
        owner_user_id: str,
        provider_kind: str,
        model_slug: str,
        project_id: str,
        segment_id: str,
        start_ms: int,
        end_ms: int,
        filename: str,
        byte_size: int,
        requested_language: str | None,
        resolved_language: str,
        requested_target_language: str | None,
        resolved_target_language: str | None,
        started: float,
        text: str,
        error_message: str | None,
        credential: CredentialSnapshot | None = None,
    ) -> str:
        log_id = str(uuid4())
        snap = credential or CredentialSnapshot()
        self.session.add(
            LlmCallLog(
                id=log_id,
                owner_user_id=owner_user_id,
                call_source="audio_annotation",
                provider_kind=provider_kind,
                model=model_slug,
                trace_id=str(uuid4()),
                request_payload={
                    "model": model_slug,
                    "language": resolved_language,
                    "target_language": resolved_target_language,
                    "project_id": project_id,
                    "segment_id": segment_id,
                    "start_ms": start_ms,
                    "end_ms": end_ms,
                    "requested_language": requested_language,
                    "requested_target_language": requested_target_language,
                    "attachments": [
                        {
                            "filename": filename,
                            "mime_type": "audio/wav",
                            "byte_size": byte_size,
                        }
                    ],
                },
                response_payload={
                    "status": "failed" if error_message else "completed",
                    "content": text,
                },
                latency_ms=max(0, round((time.perf_counter() - started) * 1000)),
                status="error" if error_message else "success",
                error_message=error_message,
                **snap.as_kwargs(),
            )
        )
        return log_id

    async def transcribe(
        self,
        project_id: str,
        *,
        owner_user_id: str,
        upload: IncomingFile,
        model_id: str,
        segment_id: str,
        start_ms: int,
        end_ms: int,
        language_tag: str | None,
        target_language_tag: str | None,
        credential: CredentialSnapshot | None = None,
        settle=None,
    ) -> SegmentResult:
        try:
            model, provider = await self._model(model_id)
            resolved_language = resolve_transcription_language(model, provider, language_tag)
            resolved_target_language = resolve_transcription_target_language(
                model, provider, target_language_tag
            )
            if target_language_tag and resolved_target_language is None:
                raise AnnotationTranscriptionError(
                    "当前模型不支持所选输出语言",
                    code="target_language_unsupported",
                    status=409,
                )
            parameters = resolve_parameters(
                ModelTestTranscriptionParametersIn(
                    language=resolved_language,
                    target_language=resolved_target_language,
                ),
                model,
                provider,
            )
            payload, _duration_ms = await self._validate_wav(
                upload,
                expected_duration_ms=end_ms - start_ms,
                max_bytes=max_transcription_input_bytes(provider),
            )
            byte_size = len(payload)
            filename = f"segment-{segment_id}.wav"
            provider_kind = provider.kind
            model_slug = model.slug
            base_url = provider.base_url
            api_key = decrypt_secret(provider.api_key_ciphertext)
            request_options = parameters.model_dump(mode="json")
            await self.session.rollback()

            started = time.perf_counter()
            try:
                result = await transcribe_model_audio(
                    provider_kind=provider_kind,
                    base_url=base_url,
                    api_key=api_key,
                    model=model_slug,
                    filename=filename,
                    source=io.BytesIO(payload),
                    mime_type="audio/wav",
                    byte_size=byte_size,
                    language=resolved_language,
                    parameters=request_options,
                )
                text = _translated_text(result) if resolved_target_language else result.text.strip()
                if len(text) > _MAX_TEXT_LENGTH:
                    raise ValueError("语音识别文本超过单个标注片段允许的长度")
            except Exception as exc:
                message = safe_transcription_error(exc)
                await self._log(
                    owner_user_id=owner_user_id,
                    provider_kind=provider_kind,
                    model_slug=model_slug,
                    project_id=project_id,
                    segment_id=segment_id,
                    start_ms=start_ms,
                    end_ms=end_ms,
                    filename=filename,
                    byte_size=byte_size,
                    requested_language=language_tag,
                    resolved_language=resolved_language,
                    requested_target_language=target_language_tag,
                    resolved_target_language=resolved_target_language,
                    started=started,
                    text="",
                    error_message=message,
                    credential=credential,
                )
                failure = AnnotationTranscriptionError(
                    message, code="segment_transcription_failed", status=502
                )
                if settle is not None:
                    await settle(error=failure)
                await self.session.commit()
                raise failure from exc

            log_id = await self._log(
                owner_user_id=owner_user_id,
                provider_kind=provider_kind,
                model_slug=model_slug,
                project_id=project_id,
                segment_id=segment_id,
                start_ms=start_ms,
                end_ms=end_ms,
                filename=filename,
                byte_size=byte_size,
                requested_language=language_tag,
                resolved_language=resolved_language,
                requested_target_language=target_language_tag,
                resolved_target_language=resolved_target_language,
                started=started,
                text=text,
                error_message=None,
                credential=credential,
            )
            result = SegmentResult(
                text=text,
                model_id=model_id,
                requested_language=language_tag,
                resolved_language=resolved_language,
                requested_target_language=target_language_tag,
                resolved_target_language=resolved_target_language,
                log_id=log_id,
            )
            if settle is not None:
                await settle(result=result)
            await self.session.commit()
            return result
        finally:
            await upload.close()
