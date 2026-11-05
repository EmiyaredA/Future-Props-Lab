"""Compatibility bindings for the old site's shared file and model records."""

from contextlib import asynccontextmanager

from sqlalchemy import select

from app.capabilities.asset_store.asset_scope import is_library_asset
from app.capabilities.asset_store.library import AssetError, AssetLibrary
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage
from studio.apps.audio_annotation.sources import (
    AnnotationAudio,
    AudioAnnotationError,
    TranscriptionSource,
)
from studio.apps.model_service.storage.models.model_test import ModelTestTranscriptionTask
from studio.contracts.asset_library.annotation import MAX_AUDIO_BYTES
from studio.contracts.asset_library.descriptions import LibraryAssetDescription

TRANSCRIPTION_EXTENSIONS = {".mp3", ".wav", ".m4a", ".ogg"}


def audio(row):
    return AnnotationAudio(
        LibraryAssetDescription.model_validate(row, from_attributes=True),
        row.owner_user_id,
        row.display_name,
    )


class LegacyAnnotationSources:
    def __init__(self, session, settings):
        self.session, self.settings = session, settings
        self.storage = AssetStorage(self.settings)

    async def describe(self, asset_id):
        row = await self.session.get(VisualAsset, asset_id)
        if row is not None and not is_library_asset(row):
            raise AudioAnnotationError("只能使用账号文件库中的音频", code="scope_mismatch")
        return audio(row) if row is not None else None

    async def describe_many(self, asset_ids):
        if not asset_ids:
            return {}
        rows = await self.session.scalars(select(VisualAsset).where(VisualAsset.id.in_(asset_ids)))
        return {row.id: audio(row) for row in rows if is_library_asset(row)}

    @asynccontextmanager
    async def open(self, asset):
        row = await self.session.get(VisualAsset, asset.id)
        if row is None or not is_library_asset(row):
            raise AudioAnnotationError("音频文件不存在", code="not_found", status=404)
        path = self.storage.path_for(row)
        if not path.is_file():
            raise AudioAnnotationError("音频文件内容不存在", code="file_missing", status=404)
        yield path

    @asynccontextmanager
    async def transcription(self, task_id):
        task = await self.session.get(ModelTestTranscriptionTask, task_id)
        if task is None:
            raise AudioAnnotationError("识别任务不存在", code="not_found", status=404)
        if task.status != "completed":
            raise AudioAnnotationError(
                "只有已完成的识别任务可以导入标注", code="transcription_not_completed", status=409
            )
        filename = task.input_filename
        text, segments = task.result_text or "", list(task.result_segments or [])
        row = (
            await self.session.get(VisualAsset, task.source_asset_id)
            if task.source_asset_id
            else None
        )
        if (
            row is not None
            and is_library_asset(row)
            and row.media_kind == "audio"
            and row.byte_size <= MAX_AUDIO_BYTES
        ):
            yield TranscriptionSource(audio(row), filename, text, segments)
            return
        owner, mime_type = task.owner_user_id, task.input_mime_type
        path = self.settings.account_model_test_path(owner, "references") / task.input_storage_key
        if not path.is_file():
            raise AudioAnnotationError(
                "识别任务的源音频已不存在", code="source_not_found", status=404
            )
        await self.session.rollback()
        try:
            row, cleanup = await AssetLibrary(self.session, self.settings).stage_local_copy(
                path,
                owner_user_id=owner,
                filename=filename,
                content_type=mime_type,
                allowed_extensions=TRANSCRIPTION_EXTENSIONS,
            )
        except AssetError as exc:
            raise AudioAnnotationError(str(exc), code=exc.code, status=exc.status) from exc
        asset = audio(row)
        try:
            yield TranscriptionSource(asset, filename, text, segments)
        except BaseException:
            await self.session.rollback()
            if await self.session.get(VisualAsset, asset.id) is None:
                cleanup.unlink(missing_ok=True)
            raise
