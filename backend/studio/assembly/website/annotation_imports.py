"""Bind Model task originals and Asset records to one website creation transaction."""

import asyncio
from contextlib import asynccontextmanager, suppress
from copy import deepcopy
from pathlib import Path

from studio.apps.asset_library.storage.models import VisualAsset
from studio.apps.asset_library.storage.scope import is_library_asset
from studio.apps.asset_library.storage.uploads import AssetLibrary
from studio.apps.audio_annotation.clients.creation_inputs import (
    AudioCreationInputs,
    measure_duration,
)
from studio.apps.audio_annotation.sources import AudioAnnotationError
from studio.apps.model_service.storage.models.model_test import ModelTestTranscriptionTask
from studio.assembly.website.annotation_sources import audio
from studio.contracts.asset_library.annotation import MAX_AUDIO_BYTES
from studio.contracts.asset_library.errors import AssetError
from studio.runtime.ids import new_id

TRANSCRIPTION_EXTENSIONS = {".mp3", ".wav", ".m4a", ".ogg"}


class WebsiteTranscript:
    """Borrowed source; staging precedes SQL and cleanup verifies commit outcome."""

    def __init__(self, *, inputs, filename, text, segments, asset, path, owner, mime_type):
        self.inputs, self.filename = inputs, filename
        self.filename_stem = Path(filename).stem
        self.text, self.segments = text, segments
        self.asset, self.path, self.owner, self.mime_type = asset, path, owner, mime_type
        self.staged = None

    async def duration(self):
        if self.asset is not None:
            return await self.inputs.duration(self.asset)
        return await measure_duration(self.path)

    async def publish(self):
        if self.asset is not None:
            return self.asset
        session = self.inputs.session
        await session.rollback()
        # The background copy must finish before cancellation removes its output.
        # No SQL writes occur inside this task, so it never shares a Session writer.
        copying = asyncio.create_task(
            AssetLibrary(session, self.inputs.settings).stage_local_copy(
                self.path,
                owner_user_id=self.owner,
                filename=self.filename,
                content_type=self.mime_type,
                allowed_extensions=TRANSCRIPTION_EXTENSIONS,
                max_bytes=MAX_AUDIO_BYTES,
                defer_persistence=True,
            )
        )
        try:
            row, cleanup = await asyncio.shield(copying)
        except asyncio.CancelledError:
            with suppress(Exception):
                _, cleanup = await copying
                cleanup.unlink(missing_ok=True)
            raise
        except AssetError as exc:
            raise AudioAnnotationError(str(exc), code=exc.code, status=exc.status) from exc
        row.id, row.revision = new_id(), 0
        self.staged = (row.id, cleanup)
        session.add(row)
        self.asset = audio(row)
        return self.asset

    async def close(self):
        if self.staged is None:
            return
        identity, path = self.staged
        await self.inputs.session.rollback()
        # Query after rollback: a commit may have succeeded before its acknowledgement
        # failed. Keep bytes whenever the row exists or its outcome cannot be checked.
        if await self.inputs.session.get(VisualAsset, identity) is None:
            path.unlink(missing_ok=True)


class WebsiteCreationInputs(AudioCreationInputs):
    def __init__(self, *, sources, session, settings):
        super().__init__(sources)
        self.session, self.settings = session, settings

    @asynccontextmanager
    async def transcription(self, task_id):
        task = await self.session.get(ModelTestTranscriptionTask, task_id)
        if task is None:
            raise AudioAnnotationError("识别任务不存在", code="not_found", status=404)
        if task.status != "completed":
            raise AudioAnnotationError(
                "只有已完成的识别任务可以导入标注", code="transcription_not_completed", status=409
            )
        row = (
            await self.session.get(VisualAsset, task.source_asset_id)
            if task.source_asset_id
            else None
        )
        asset = (
            audio(row)
            if (
                row is not None
                and is_library_asset(row)
                and row.media_kind == "audio"
                and row.byte_size <= MAX_AUDIO_BYTES
            )
            else None
        )
        path = None
        if asset is None:
            path = (
                self.settings.account_model_test_path(task.owner_user_id, "references")
                / task.input_storage_key
            )
            if not path.is_file():
                raise AudioAnnotationError(
                    "识别任务的源音频已不存在", code="source_not_found", status=404
                )
        source = WebsiteTranscript(
            inputs=self,
            filename=task.input_filename,
            text=task.result_text or "",
            segments=deepcopy(task.result_segments or []),
            asset=asset,
            path=path,
            owner=task.owner_user_id,
            mime_type=task.input_mime_type,
        )
        await self.session.rollback()
        try:
            yield source
        finally:
            await source.close()
