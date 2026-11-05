"""Media and model adapters own temporary files and close input streams."""

import asyncio
import tempfile
from pathlib import Path

from studio.apps.audio_annotation.rules.audio import require_audio
from studio.apps.audio_annotation.sources import AudioAnnotationError
from studio.apps.media_rendering.local.audio_clip import extract_wav


class LocalClips:
    def __init__(self, *, sources, release_reads, staging):
        self.sources, self.release_reads, self.staging = sources, release_reads, staging

    async def read(self, asset_id, start_ms, end_ms):
        audio = require_audio(await self.sources.describe(asset_id))
        await self.release_reads()
        async with self.sources.open(audio) as source:
            # Local source validation can start another read transaction.
            await self.release_reads()
            with tempfile.TemporaryDirectory(
                prefix="annotation-clip-", dir=self.staging
            ) as directory:
                target = Path(directory) / "clip.wav"
                try:
                    await extract_wav(source, target, start_ms, end_ms)
                except (ValueError, FileNotFoundError, TimeoutError) as exc:
                    raise AudioAnnotationError(
                        "片段裁切失败，请检查媒体运行环境", code="clip_failed", status=422
                    ) from exc
                return await asyncio.to_thread(target.read_bytes)


class ClipInput:
    content_type = "audio/wav"
    filename = "segment.wav"

    def __init__(self, content):
        self.content = content
        self.offset = 0

    async def read(self, size=-1):
        data = (
            self.content[self.offset :]
            if size < 0
            else self.content[self.offset : self.offset + size]
        )
        self.offset += len(data)
        return data

    async def close(self):
        self.content = b""


class SegmentRecognition:
    def __init__(self, transcriber):
        self.transcriber = transcriber

    async def recognize(self, project_id, segment, command, content):
        upload = ClipInput(content)
        try:
            return await self.transcriber(
                project_id,
                upload=upload,
                model_id=command.model_id,
                segment_id=segment.id,
                start_ms=segment.start_ms,
                end_ms=segment.end_ms,
                language_tag=command.language,
                target_language_tag=command.target_language,
            )
        finally:
            await upload.close()
