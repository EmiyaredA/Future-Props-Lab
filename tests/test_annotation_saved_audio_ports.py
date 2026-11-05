"""Saved-audio rules run with a byte stub and the real local media adapter."""

import asyncio
import io
import json
import wave
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from tests.test_annotation_creation_ports import audio

from studio.apps.audio_annotation.clients.saved_audio import LocalClips, SegmentRecognition
from studio.apps.audio_annotation.schemas.document import AudioAnnotationDocumentOut
from studio.apps.audio_annotation.schemas.operations import SavedSegmentTranscriptionIn
from studio.apps.audio_annotation.sources import AudioAnnotationError
from studio.apps.audio_annotation.use_cases.saved_audio import SavedAudio
from studio.runtime.revisions import RevisionConflictError


def wav_bytes():
    output = io.BytesIO()
    with wave.open(output, "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(8000)
        target.writeframes(b"\0\0" * 8000)
    return output.getvalue()


class Documents:
    def __init__(self):
        self.project = SimpleNamespace(
            id="project",
            asset_id="source-audio",
            title="Title",
            duration_ms=1000,
            asset_display_name="source",
            original_filename="source.wav",
            mime_type="audio/wav",
            byte_size=len(wav_bytes()),
        )
        self.document = AudioAnnotationDocumentOut(
            project_id="project",
            schema_version="1.0",
            speakers=[],
            segments=[dict(id="segment", start_ms=0, end_ms=1000, text="draft", status="draft")],
            revision=3,
            updated_at="2026-11-05",
        )

    async def get(self, project_id):
        if project_id != "project":
            raise AudioAnnotationError("missing", code="not_found", status=404)
        return self.project

    async def get_document(self, project_id):
        await self.get(project_id)
        return self.document.model_copy(deep=True)


class Sources:
    def __init__(self, path):
        self.path, self.opened, self.closed, self.released = path, 0, 0, 0

    async def describe(self, asset_id):
        assert asset_id == "source-audio"
        return audio()

    async def release(self):
        self.released += 1

    @asynccontextmanager
    async def open(self, _audio):
        self.opened += 1
        try:
            yield self.path
        finally:
            self.closed += 1


class MemoryClips:
    async def read(self, asset_id, start_ms, end_ms):
        assert (asset_id, start_ms, end_ms) == ("source-audio", 0, 1000)
        return wav_bytes()


@pytest.fixture(params=["memory", "media"])
def saved(request, tmp_path):
    path = tmp_path / "input.wav"
    path.write_bytes(wav_bytes())
    sources = Sources(path)
    clips = (
        MemoryClips()
        if request.param == "memory"
        else LocalClips(
            sources=sources,
            release_reads=sources.release,
            staging=tmp_path,
        )
    )
    calls = []

    async def transcriber(project_id, *, upload, **kwargs):
        calls.append((project_id, upload, kwargs))
        with wave.open(io.BytesIO(await upload.read()), "rb") as content:
            assert content.getnframes() > 0
        return "candidate transcript"

    documents = Documents()
    operation = SavedAudio(
        documents=documents,
        clips=clips,
        recognition=SegmentRecognition(transcriber),
        clock=lambda: datetime(2026, 11, 5, tzinfo=UTC),
    )
    return SimpleNamespace(
        operation=operation, documents=documents, calls=calls, sources=sources, directory=tmp_path
    )


async def test_saved_audio_contract_checks_revision_and_returns_uncommitted_candidate(saved):
    operation = saved.operation
    with pytest.raises(RevisionConflictError):
        await operation.clip("project", "segment", 2)
    with pytest.raises(AudioAnnotationError):
        await operation.clip("project", "missing", 3)
    assert saved.sources.opened == 0
    content, mime, filename = await operation.export("project", 3, "json")
    assert mime == "application/json" and filename == "project.annotation.json"
    assert json.loads(content)["exported_at"] == "2026-11-05T00:00:00Z"
    candidate = await operation.transcribe(
        "project", "segment", SavedSegmentTranscriptionIn(expected_revision=3, model_id="model")
    )
    assert candidate == "candidate transcript"
    assert saved.documents.document.revision == 3
    assert saved.documents.document.segments[0].text == "draft"
    assert len(saved.calls) == 1 and saved.calls[0][1].content == b""
    assert saved.sources.opened == saved.sources.closed
    assert list(saved.directory.iterdir()) == [saved.directory / "input.wav"]


@pytest.mark.parametrize("failure", [OSError("failed"), asyncio.CancelledError()])
async def test_media_adapter_closes_source_and_removes_temporary_clip(
    tmp_path, monkeypatch, failure
):
    sources = Sources(tmp_path / "input.wav")

    async def interrupted(_source, target, *_bounds):
        target.write_bytes(b"partial")
        raise failure

    monkeypatch.setattr("studio.apps.audio_annotation.clients.saved_audio.extract_wav", interrupted)
    clips = LocalClips(sources=sources, release_reads=sources.release, staging=tmp_path)
    with pytest.raises(type(failure)):
        await clips.read("source-audio", 0, 1000)
    assert sources.opened == sources.closed == 1
    assert sources.released == 2
    assert not list(tmp_path.iterdir())
