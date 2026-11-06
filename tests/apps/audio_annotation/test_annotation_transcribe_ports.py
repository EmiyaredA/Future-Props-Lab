"""Authorization and range rules precede every replaceable transcription attempt."""

from types import SimpleNamespace

import pytest

from studio.apps.audio_annotation.clients.saved_audio import ClipInput
from studio.apps.audio_annotation.schemas.document import AudioAnnotationSegmentTranscriptionOut
from studio.apps.audio_annotation.sources import AudioAnnotationError
from studio.apps.audio_annotation.use_cases.transcribe_segment import (
    TranscribeSegment,
    TranscriptionScope,
)
from studio.assembly.website.annotation_transcription import WebsiteTranscription


class Projects:
    async def load(self, project_id):
        if project_id != "owned":
            raise AudioAnnotationError("missing", code="not_found", status=404)
        return TranscriptionScope("alice", 1000)


class Executor:
    def __init__(self, failure=None):
        self.failure, self.calls = failure, []

    async def __call__(self, project_id, **parameters):
        self.calls.append((project_id, parameters))
        assert parameters["owner_user_id"] == "alice"
        assert await parameters["upload"].read() == b"wav"
        if self.failure:
            raise self.failure
        return "candidate"


@pytest.mark.parametrize(
    ("project", "principal", "start", "end", "code"),
    [
        ("foreign", None, 0, 1000, "not_found"),
        ("owned", "bob", 0, 1000, "not_found"),
        ("owned", "alice", 0, 99, "segment_too_short"),
        ("owned", "alice", -1, 1000, "segment_out_of_range"),
        ("owned", "alice", 0, 1001, "segment_out_of_range"),
    ],
)
async def test_invalid_scope_closes_upload_without_external_work(
    project, principal, start, end, code
):
    executor = Executor()
    upload = ClipInput(b"wav")
    with pytest.raises(AudioAnnotationError) as error:
        await TranscribeSegment(Projects(), executor)(
            project,
            upload=upload,
            start_ms=start,
            end_ms=end,
            principal=SimpleNamespace(user_id=principal) if principal else None,
        )
    assert error.value.code == code
    assert not executor.calls and upload.content == b""


@pytest.mark.parametrize("unknown", [False, True])
async def test_transcription_calls_executor_once_and_closes_upload_after_unknown_result(unknown):
    executor = Executor(OSError("unknown provider result") if unknown else None)
    upload = ClipInput(b"wav")
    call = TranscribeSegment(Projects(), executor)(
        "owned",
        upload=upload,
        start_ms=0,
        end_ms=1000,
        model_id="model",
        segment_id="segment",
        language_tag=None,
        target_language_tag=None,
    )
    if unknown:
        with pytest.raises(OSError, match="unknown provider result"):
            await call
    else:
        assert await call == "candidate"
    assert len(executor.calls) == 1 and upload.content == b""


@pytest.mark.parametrize("adapter", ["memory", "website"])
async def test_model_executor_contract_returns_candidate_and_releases_input(adapter):
    candidate = AudioAnnotationSegmentTranscriptionOut(
        text="candidate",
        model_id="model",
        requested_language=None,
        resolved_language="zh",
        requested_target_language=None,
        resolved_target_language=None,
        log_id="call-log",
    )
    calls = []

    async def recognize(project_id, *, owner_user_id, upload, model_id, **_kwargs):
        assert project_id == "owned" and owner_user_id == "alice"
        assert model_id == candidate.model_id
        calls.append(await upload.read())
        return candidate

    models = SimpleNamespace(transcribe=recognize)
    executor = recognize if adapter == "memory" else WebsiteTranscription(None, models)
    upload = ClipInput(b"wav")
    result = await TranscribeSegment(Projects(), executor)(
        "owned",
        upload=upload,
        model_id=candidate.model_id,
        segment_id="segment",
        start_ms=0,
        end_ms=1000,
        language_tag=None,
        target_language_tag=None,
    )
    assert result == candidate
    assert calls == [b"wav"] and upload.content == b""
