"""Validate the owned range then delegate the exact WAV attempt to Models."""

import hashlib
from uuid import uuid4

import httpx
from pydantic import ValidationError

from studio.apps.audio_annotation.schemas.document import AudioAnnotationSegmentTranscriptionOut
from studio.apps.audio_annotation.sources import AudioAnnotationError
from studio.apps.audio_annotation.storage.transcription_scope import transcribe_project
from studio.contracts.identity.delegation import RequestGrant
from studio.contracts.model_service.annotation import (
    HEADER,
    MAX_BYTES,
    PURPOSE,
    WAV_TYPES,
    SegmentInput,
)
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable


class SegmentTranscription:
    def __init__(self, connection, capabilities):
        self.connection, self.capabilities = connection, capabilities

    async def __call__(
        self,
        session,
        project_id,
        *,
        upload,
        model_id,
        segment_id,
        start_ms,
        end_ms,
        language_tag,
        target_language_tag,
        principal=None,
    ):
        try:
            owner = await transcribe_project(session, project_id, start_ms, end_ms)
            if principal is not None and principal.user_id != owner:
                raise AudioAnnotationError("标注任务不存在", code="not_found", status=404)
            if not 1 <= len(model_id) <= 36:
                raise AudioAnnotationError(
                    "当前语音识别模型不可用", code="model_unavailable", status=409
                )
            await session.rollback()
            content_type = (upload.content_type or "application/octet-stream").lower().strip()
            if content_type not in WAV_TYPES:
                raise AudioAnnotationError("片段音频必须为 WAV", code="invalid_segment_audio")
            content = await upload.read(MAX_BYTES + 1)
            if not content:
                raise AudioAnnotationError("片段音频不能为空", code="empty_segment_audio")
            if len(content) > MAX_BYTES:
                raise AudioAnnotationError(
                    "片段音频不能超过 100 MB", code="segment_audio_too_large", status=413
                )
            segment = SegmentInput(
                project_id=project_id,
                segment_id=segment_id,
                model_id=model_id,
                start_ms=start_ms,
                end_ms=end_ms,
                language_tag=language_tag,
                target_language_tag=target_language_tag,
                attempt_id=uuid4(),
                byte_size=len(content),
                sha256=hashlib.sha256(content).hexdigest(),
            )
            return await self._send(segment, content)
        except ValidationError as exc:
            raise AudioAnnotationError("片段识别参数无效", code="invalid_segment_audio") from exc
        finally:
            await upload.close()

    async def _send(self, segment, content):
        grant = RequestGrant(
            "annotation",
            PURPOSE,
            self.connection.method,
            self.connection.url.path,
            "models",
            "POST",
            segment.path,
        )
        try:
            assertion = await self.capabilities.authorize_request(
                self.connection.state.service_assertion, grant
            )
            response = await self.capabilities.client.post(
                "http://models:8080" + segment.path,
                content=content,
                headers={
                    "X-Fpl-Context": assertion,
                    "Content-Type": "audio/wav",
                    HEADER: segment.header(),
                },
                timeout=httpx.Timeout(180, connect=5),
            )
            if response.status_code == 200:
                return AudioAnnotationSegmentTranscriptionOut.model_validate_json(response.content)
            info = response.json()
            if response.status_code in {401, 403, 404, 409, 413, 422, 502}:
                raise AudioAnnotationError(
                    str(info.get("detail") or "片段识别请求失败")[:1000],
                    code=info.get("code") or "segment_transcription_failed",
                    status=response.status_code,
                )
        except CapabilityDenied as exc:
            raise AudioAnnotationError(
                "当前账号无权识别片段", code="transcription_forbidden", status=exc.status
            ) from exc
        except (CapabilityUnavailable, httpx.HTTPError, ValueError, AttributeError):
            pass
        raise AudioAnnotationError(
            "片段识别结果未确认，请查看调用日志", code="transcription_unavailable", status=503
        )
