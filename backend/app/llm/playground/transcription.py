from __future__ import annotations

import asyncio
import os
from pathlib import Path
from uuid import uuid4

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.concurrency.revisions import RevisionConflictError
from app.concurrency.task_admission import TaskAdmission
from app.core.config import Settings, get_settings
from app.core.time import iso_utc
from app.files.incoming import IncomingFile
from app.files.policy import ALLOWED_FILES, looks_like
from app.files.storage import AssetStorage
from app.llm.providers.senseaudio_asr import MAX_ASR_FILE_BYTES
from app.llm.transcription import (
    TranscriptionParameterError,
    max_transcription_input_bytes,
    model_supports_transcription,
    parameter_capabilities,
    resolve_parameters,
)
from app.models import ModelEntry, ModelProvider, ModelTestTranscriptionTask, VisualAsset
from app.schemas.model_test import (
    ModelTestTranscriptionCreateIn,
    ModelTestTranscriptionOptionListOut,
    ModelTestTranscriptionOptionOut,
    ModelTestTranscriptionParametersIn,
    ModelTestTranscriptionParametersOut,
    ModelTestTranscriptionResultDetailOut,
    ModelTestTranscriptionSourceOut,
    ModelTestTranscriptionTaskListOut,
    ModelTestTranscriptionTaskOut,
)

TRANSCRIPTION_EXTENSIONS = (".mp3", ".wav", ".m4a", ".ogg")
TRANSCRIPTION_MIME_TYPES = tuple(
    sorted({mime for extension in TRANSCRIPTION_EXTENSIONS for mime in ALLOWED_FILES[extension][1]})
)
ACTIVE_TRANSCRIPTION_STATUSES = ("queued", "running")


class ModelTestTranscriptionError(Exception):
    def __init__(
        self, message: str, *, code: str = "transcription_error", status: int = 422
    ) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


def transcription_task_out(
    row: ModelTestTranscriptionTask, settings: Settings
) -> ModelTestTranscriptionTaskOut:
    path = (
        settings.workspace_model_test_path(row.workspace_id, "references") / row.input_storage_key
    )
    custom_pro = row.provider_kind == "senseaudio_asr_pro" or row.model_slug == "pro-asr"
    senseaudio = row.provider_kind in {"senseaudio_asr", "senseaudio_asr_pro"}
    stored_parameters = {
        "language": row.language,
        "target_language": None,
        "enable_word_timestamps": False,
        "enable_text_edit": custom_pro,
        "enable_speaker_diarization": senseaudio,
        "max_speakers": None,
        "enable_punctuation": senseaudio and not custom_pro,
        "hotwords": None,
        "abbreviations": False,
        **dict(row.request_options or {}),
    }
    return ModelTestTranscriptionTaskOut(
        id=row.id,
        provider_id=row.provider_id,
        model_id=row.model_id,
        provider_kind=row.provider_kind,
        provider_name=row.provider_name,
        model_slug=row.model_slug,
        language=row.language,
        parameters=ModelTestTranscriptionParametersOut.model_validate(stored_parameters),
        status=row.status,
        source=ModelTestTranscriptionSourceOut(
            kind=row.source_kind,
            source_asset_id=row.source_asset_id,
            filename=row.input_filename,
            mime_type=row.input_mime_type,
            byte_size=row.input_byte_size,
            available=path.is_file(),
        ),
        result_text=row.result_text,
        result_segments=list(row.result_segments or []),
        result_detail=ModelTestTranscriptionResultDetailOut.model_validate(
            dict(row.result_detail or {})
        ),
        error_message=row.error_message,
        log_id=row.log_id,
        revision=row.revision,
        created_at=iso_utc(row.created_at),
        updated_at=iso_utc(row.updated_at),
        started_at=iso_utc(row.started_at) if row.started_at else None,
        completed_at=iso_utc(row.completed_at) if row.completed_at else None,
    )


def _validate_file_metadata(filename: str, content_type: str) -> tuple[str, str]:
    safe_name = Path(filename).name
    extension = Path(safe_name).suffix.lower()
    if not safe_name or extension not in TRANSCRIPTION_EXTENSIONS:
        raise ModelTestTranscriptionError(
            "仅支持 MP3、WAV、M4A 和 OGG 音频", code="unsupported_file_type"
        )
    mime_types = ALLOWED_FILES[extension][1]
    normalized_mime = content_type.lower().strip() or "application/octet-stream"
    if normalized_mime not in mime_types and normalized_mime != "application/octet-stream":
        raise ModelTestTranscriptionError("文件扩展名与 MIME 类型不匹配", code="file_type_mismatch")
    return extension, normalized_mime if normalized_mime in mime_types else sorted(mime_types)[0]


def _max_input_bytes(provider: ModelProvider) -> int:
    return max_transcription_input_bytes(provider)


def _limit_message(max_bytes: int) -> str:
    return f"单个音频不能超过 {max_bytes // (1024 * 1024)} MB"


def _validate_staged_file(path: Path, extension: str, size: int, max_bytes: int) -> None:
    if size <= 0:
        raise ModelTestTranscriptionError("音频文件不能为空", code="empty_file")
    if size > max_bytes:
        raise ModelTestTranscriptionError(
            _limit_message(max_bytes), code="file_too_large", status=413
        )
    with path.open("rb") as source:
        head = source.read(512)
    if not looks_like(extension, head):
        raise ModelTestTranscriptionError(
            "文件内容与声明的音频类型不匹配", code="invalid_file_content"
        )


def _copy_limited(source_path: Path, target_path: Path, max_bytes: int) -> int:
    size = 0
    with source_path.open("rb") as source, target_path.open("xb") as target:
        while chunk := source.read(1024 * 1024):
            size += len(chunk)
            if size > max_bytes:
                raise ModelTestTranscriptionError(
                    _limit_message(max_bytes), code="file_too_large", status=413
                )
            target.write(chunk)
    return size


class ModelTestTranscription:
    def __init__(
        self, session: AsyncSession, workspace_id: str, settings: Settings | None = None
    ) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.settings = settings or get_settings()
        self.asset_storage = AssetStorage(self.settings)

    async def _model(self, model_id: str) -> tuple[ModelEntry, ModelProvider]:
        model = await self.session.get(ModelEntry, model_id)
        provider = (
            await self.session.get(ModelProvider, model.provider_id) if model is not None else None
        )
        if model is None or provider is None or not model_supports_transcription(model, provider):
            raise ModelTestTranscriptionError(
                "当前语音识别模型不可用", code="model_unavailable", status=409
            )
        if not provider.api_key_ciphertext:
            raise ModelTestTranscriptionError(
                "供应商尚未配置 API Key", code="missing_api_key", status=409
            )
        return model, provider

    async def options(self) -> ModelTestTranscriptionOptionListOut:
        rows = (
            await self.session.execute(
                select(ModelEntry, ModelProvider)
                .join(ModelProvider, ModelProvider.id == ModelEntry.provider_id)
                .where(
                    ModelProvider.enabled.is_(True),
                    ModelEntry.enabled.is_(True),
                    ModelProvider.kind.in_(("openai", "senseaudio_asr", "senseaudio_asr_pro")),
                )
                .order_by(ModelProvider.sort_order, ModelEntry.sort_order)
            )
        ).all()
        return ModelTestTranscriptionOptionListOut(
            items=[
                ModelTestTranscriptionOptionOut(
                    id=model.id,
                    provider_id=provider.id,
                    provider_name=provider.name,
                    provider_kind=provider.kind,
                    slug=model.slug,
                    label=model.label or model.slug,
                    description=model.description,
                    max_input_bytes=_max_input_bytes(provider),
                    parameter_capabilities=parameter_capabilities(model, provider),
                )
                for model, provider in rows
                if model_supports_transcription(model, provider)
            ],
            max_input_bytes=MAX_ASR_FILE_BYTES,
            accepted_extensions=list(TRANSCRIPTION_EXTENSIONS),
            accepted_mime_types=list(TRANSCRIPTION_MIME_TYPES),
        )

    async def create_upload(
        self,
        upload: IncomingFile,
        *,
        model_id: str,
        parameters: ModelTestTranscriptionParametersIn,
        admission: TaskAdmission | None = None,
    ) -> ModelTestTranscriptionTaskOut:
        try:
            filename = Path(upload.filename or "").name
            extension, mime_type = _validate_file_metadata(
                filename, upload.content_type or "application/octet-stream"
            )
            model, provider = await self._model(model_id)
            resolved_parameters = resolve_parameters(parameters, model, provider)
        except TranscriptionParameterError as exc:
            await upload.close()
            raise ModelTestTranscriptionError(
                str(exc), code="invalid_transcription_parameters"
            ) from exc
        except Exception:
            await upload.close()
            raise
        snapshots = (model.id, model.slug, provider.id, provider.name, provider.kind)
        max_bytes = _max_input_bytes(provider)
        await self.session.rollback()
        workspace_id = self.workspace_id
        storage_key, temp_path, final_path = self._paths(workspace_id)
        size = 0
        try:
            with temp_path.open("xb") as target:
                while chunk := await upload.read(1024 * 1024):
                    size += len(chunk)
                    if size > max_bytes:
                        raise ModelTestTranscriptionError(
                            _limit_message(max_bytes), code="file_too_large", status=413
                        )
                    target.write(chunk)
            _validate_staged_file(temp_path, extension, size, max_bytes)
            os.replace(temp_path, final_path)
            return await self._create_row(
                snapshots=snapshots,
                storage_key=storage_key,
                filename=filename,
                mime_type=mime_type,
                byte_size=size,
                parameters=resolved_parameters,
                source_kind="upload",
                source_asset_id=None,
                final_path=final_path,
                admission=admission,
            )
        except Exception:
            temp_path.unlink(missing_ok=True)
            final_path.unlink(missing_ok=True)
            raise
        finally:
            await upload.close()

    async def create_from_library(
        self, body: ModelTestTranscriptionCreateIn, *, admission: TaskAdmission | None = None
    ) -> ModelTestTranscriptionTaskOut:
        model, provider = await self._model(body.model_id)
        try:
            resolved_parameters = resolve_parameters(body, model, provider)
        except TranscriptionParameterError as exc:
            raise ModelTestTranscriptionError(
                str(exc), code="invalid_transcription_parameters"
            ) from exc
        asset = await self.session.get(VisualAsset, body.source_asset_id)
        if (
            asset is None
            or asset.project_id is not None
            or asset.galgame_project_id is not None
            or asset.media_kind != "audio"
        ):
            raise ModelTestTranscriptionError(
                "文件管理中的音频不存在", code="source_not_found", status=404
            )
        extension, mime_type = _validate_file_metadata(asset.original_filename, asset.mime_type)
        max_bytes = _max_input_bytes(provider)
        if asset.byte_size > max_bytes:
            raise ModelTestTranscriptionError(
                _limit_message(max_bytes), code="file_too_large", status=413
            )
        source_path = self.asset_storage.path_for(asset)
        if not source_path.is_file():
            raise ModelTestTranscriptionError(
                "源音频内容不存在", code="source_not_found", status=404
            )
        snapshots = (model.id, model.slug, provider.id, provider.name, provider.kind)
        filename = asset.original_filename
        source_asset_id = asset.id
        workspace_id = asset.workspace_id
        await self.session.rollback()
        storage_key, temp_path, final_path = self._paths(workspace_id)
        try:
            size = await asyncio.to_thread(_copy_limited, source_path, temp_path, max_bytes)
            _validate_staged_file(temp_path, extension, size, max_bytes)
            os.replace(temp_path, final_path)
            return await self._create_row(
                snapshots=snapshots,
                storage_key=storage_key,
                filename=filename,
                mime_type=mime_type,
                byte_size=size,
                parameters=resolved_parameters,
                source_kind="library",
                source_asset_id=source_asset_id,
                final_path=final_path,
                admission=admission,
            )
        except Exception:
            temp_path.unlink(missing_ok=True)
            final_path.unlink(missing_ok=True)
            raise

    def _paths(self, workspace_id: str) -> tuple[str, Path, Path]:
        root = self.settings.workspace_model_test_path(workspace_id, "references")
        temp_root = root / ".tmp"
        temp_root.mkdir(parents=True, exist_ok=True)
        storage_key = uuid4().hex
        return storage_key, temp_root / f"{storage_key}.tmp", root / storage_key

    async def _create_row(
        self,
        *,
        snapshots: tuple[str, str, str, str, str],
        storage_key: str,
        filename: str,
        mime_type: str,
        byte_size: int,
        parameters: ModelTestTranscriptionParametersOut,
        source_kind: str,
        source_asset_id: str | None,
        final_path: Path,
        admission: TaskAdmission | None = None,
    ) -> ModelTestTranscriptionTaskOut:
        model_id, model_slug, provider_id, provider_name, provider_kind = snapshots
        row = ModelTestTranscriptionTask(
            provider_id=provider_id,
            model_id=model_id,
            provider_kind=provider_kind,
            provider_name=provider_name,
            model_slug=model_slug,
            source_kind=source_kind,
            source_asset_id=source_asset_id,
            input_storage_key=storage_key,
            input_filename=filename,
            input_mime_type=mime_type,
            input_byte_size=byte_size,
            language=parameters.language,
            request_options=parameters.model_dump(mode="json"),
        )
        try:
            self.session.add(row)
            await self.session.flush()
            if admission:
                await admission([row.id])
            await self.session.commit()
            await self.session.refresh(row)
        except Exception:
            await self.session.rollback()
            final_path.unlink(missing_ok=True)
            raise
        return transcription_task_out(row, self.settings)

    async def list(
        self, *, model_id: str | None, page: int, page_size: int
    ) -> ModelTestTranscriptionTaskListOut:
        conditions = [ModelTestTranscriptionTask.model_id == model_id] if model_id else []
        total = int(
            await self.session.scalar(
                select(func.count(ModelTestTranscriptionTask.id)).where(*conditions)
            )
            or 0
        )
        rows = list(
            (
                await self.session.execute(
                    select(ModelTestTranscriptionTask)
                    .where(*conditions)
                    .order_by(ModelTestTranscriptionTask.created_at.desc())
                    .offset((page - 1) * page_size)
                    .limit(page_size)
                )
            )
            .scalars()
            .all()
        )
        return ModelTestTranscriptionTaskListOut(
            items=[transcription_task_out(row, self.settings) for row in rows], total=total
        )

    async def _row(self, task_id: str) -> ModelTestTranscriptionTask:
        row = await self.session.get(ModelTestTranscriptionTask, task_id)
        if row is None:
            raise ModelTestTranscriptionError("识别任务不存在", code="not_found", status=404)
        return row

    async def get(self, task_id: str) -> ModelTestTranscriptionTaskOut:
        return transcription_task_out(await self._row(task_id), self.settings)

    async def content(self, task_id: str) -> tuple[ModelTestTranscriptionTask, Path]:
        row = await self._row(task_id)
        path = (
            self.settings.workspace_model_test_path(row.workspace_id, "references")
            / row.input_storage_key
        )
        if not path.is_file():
            raise ModelTestTranscriptionError("输入音频不存在", code="not_found", status=404)
        return row, path

    async def delete(self, task_id: str, expected_revision: int) -> None:
        row = await self._row(task_id)
        if row.status in ACTIVE_TRANSCRIPTION_STATUSES:
            raise ModelTestTranscriptionError(
                "进行中的识别任务不能删除", code="task_busy", status=409
            )
        if row.revision != expected_revision:
            raise RevisionConflictError(
                expected_revision,
                row.revision,
                transcription_task_out(row, self.settings).model_dump(mode="json"),
            )
        path = (
            self.settings.workspace_model_test_path(row.workspace_id, "references")
            / row.input_storage_key
        )
        result = await self.session.execute(
            delete(ModelTestTranscriptionTask).where(
                ModelTestTranscriptionTask.id == task_id,
                ModelTestTranscriptionTask.revision == expected_revision,
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            current = await self._row(task_id)
            raise RevisionConflictError(
                expected_revision,
                current.revision,
                transcription_task_out(current, self.settings).model_dump(mode="json"),
            )
        await self.session.commit()
        path.unlink(missing_ok=True)
