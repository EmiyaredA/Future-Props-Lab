"""Borrowed audio inspection adapter; paths never enter creation rules."""

import asyncio
from contextlib import asynccontextmanager
from copy import deepcopy
from pathlib import Path

from tinytag import TinyTag

from studio.apps.audio_annotation.sources import AudioAnnotationError


async def measure_duration(path):
    try:
        tag = await asyncio.to_thread(TinyTag.get, path)
        return round(float(tag.duration or 0) * 1000)
    except (OSError, ValueError) as exc:
        raise AudioAnnotationError("无法读取音频时长", code="audio_metadata_invalid") from exc


class BorrowedTranscript:
    def __init__(self, source, inputs):
        self._source, self._inputs = source, inputs
        self.filename_stem = Path(source.filename).stem
        self.text, self.segments = source.text, deepcopy(source.segments)

    async def duration(self):
        if self._source.asset is not None:
            return await self._inputs.duration(self._source.asset)
        return await measure_duration(self._source.original)

    async def publish(self):
        if self._source.asset is not None:
            return self._source.asset
        return await self._inputs.sources.publish_original(self._source)


class AudioCreationInputs:
    def __init__(self, sources):
        self.sources = sources

    async def describe(self, asset_id):
        return await self.sources.describe(asset_id)

    async def duration(self, audio):
        async with self.sources.open(audio) as path:
            return await measure_duration(path)

    @asynccontextmanager
    async def transcription(self, task_id):
        async with self.sources.transcription(task_id) as source:
            yield BorrowedTranscript(source, self)
