from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select

from app.core.db import SessionLocal
from app.core.tenant_context import bind_workspace
from app.llm.playground.transcription import (
    ModelTestTranscription,
    ModelTestTranscriptionError,
)
from app.llm.playground.transcription_parameters import (
    TranscriptionParameterError,
    parameter_capabilities,
    resolve_parameters,
)
from app.llm.playground.transcription_runner import ModelTestTranscriptionRunner
from app.llm.providers.transcription import (
    TranscriptionResult,
    TranscriptSegment,
    TranscriptWord,
)
from app.main import app
from app.models import ModelTestTranscriptionTask, Workspace
from app.schemas.model_test import ModelTestTranscriptionParametersIn


@pytest.mark.parametrize(
    ("kind", "base_url", "slug", "expected"),
    [
        (
            "senseaudio_asr",
            "http://180.184.148.131:30002/api/v2/asr/pro",
            "pro-asr",
            ("candidates", True, True, True, False, False, False, True),
        ),
        (
            "senseaudio_asr",
            "https://api.senseaudio.cn/v1",
            "senseaudio-asr-lite-1.0",
            ("select", False, False, False, False, False, True, False),
        ),
        (
            "senseaudio_asr",
            "https://api.senseaudio.cn/v1",
            "senseaudio-asr-standard-1.0",
            ("select", True, False, True, False, True, False, False),
        ),
        (
            "senseaudio_asr",
            "https://api.senseaudio.cn/v1",
            "senseaudio-asr-pro-1.5-260319",
            ("select", True, False, True, True, True, False, True),
        ),
        (
            "senseaudio_asr",
            "https://api.senseaudio.cn/v1",
            "senseaudio-asr-deepthink-1.0",
            ("select", False, False, False, False, False, False, True),
        ),
        (
            "openai",
            "https://gateway.example/v1",
            "whisper-1",
            ("select", False, False, False, False, False, False, False),
        ),
    ],
)
def test_transcription_parameter_capability_matrix(
    kind: str,
    base_url: str,
    slug: str,
    expected: tuple[str, bool, bool, bool, bool, bool, bool, bool],
) -> None:
    model = SimpleNamespace(slug=slug)
    provider = SimpleNamespace(kind=kind, base_url=base_url)
    capabilities = parameter_capabilities(model, provider)
    assert (
        capabilities.language_mode,
        capabilities.supports_word_timestamps,
        capabilities.supports_text_edit,
        capabilities.supports_speaker_diarization,
        capabilities.supports_max_speakers,
        capabilities.supports_punctuation,
        capabilities.supports_hotwords,
        bool(capabilities.target_language_options),
    ) == expected


def test_transcription_parameter_resolution_validates_model_combinations() -> None:
    custom_model = SimpleNamespace(slug="pro-asr")
    custom_provider = SimpleNamespace(
        kind="senseaudio_asr",
        base_url="http://180.184.148.131:30002/api/v2/asr/pro",
    )
    resolved = resolve_parameters(
        ModelTestTranscriptionParametersIn(
            language="chinese, English",
            target_language="japanese",
            enable_text_edit=False,
        ),
        custom_model,
        custom_provider,
    )
    assert resolved.language == "Chinese,English"
    assert resolved.target_language == "Japanese"
    assert resolved.enable_text_edit is False
    with pytest.raises(TranscriptionParameterError, match="语言候选"):
        resolve_parameters(
            ModelTestTranscriptionParametersIn(language="Chinese,Klingon"),
            custom_model,
            custom_provider,
        )
    with pytest.raises(TranscriptionParameterError, match="max_speakers"):
        resolve_parameters(
            ModelTestTranscriptionParametersIn(max_speakers=2),
            custom_model,
            custom_provider,
        )

    official_model = SimpleNamespace(slug="senseaudio-asr-pro-1.5-260319")
    official_provider = SimpleNamespace(
        kind="senseaudio_asr", base_url="https://api.senseaudio.cn/v1"
    )
    with pytest.raises(TranscriptionParameterError, match="必须开启说话人识别"):
        resolve_parameters(
            ModelTestTranscriptionParametersIn(
                enable_speaker_diarization=False,
                max_speakers=2,
            ),
            official_model,
            official_provider,
        )
    with pytest.raises(TranscriptionParameterError, match="enable_text_edit"):
        resolve_parameters(
            ModelTestTranscriptionParametersIn(enable_text_edit=True),
            official_model,
            official_provider,
        )


async def _create_asr_model(
    client: httpx.AsyncClient,
    *,
    kind: str = "senseaudio_asr",
    with_key: bool = True,
    capability: str = "speech_recognition",
    base_url: str = "https://gateway.example/v1",
) -> tuple[dict, dict]:
    catalog = (await client.get("/v1/model-providers")).json()
    provider_response = await client.post(
        "/v1/model-providers",
        json={
            "expected_catalog_revision": catalog["revision"],
            "name": f"asr-test-{uuid4()}",
            "kind": kind,
            "base_url": base_url,
            "api_key": "transcription-test-secret" if with_key else "",
            "enabled": True,
        },
    )
    assert provider_response.status_code == 200, provider_response.text
    provider_body = provider_response.json()
    provider = provider_body["provider"]
    model_response = await client.post(
        f"/v1/model-providers/{provider['id']}/models",
        json={
            "expected_catalog_revision": provider_body["revision"],
            "slug": f"test-asr-{uuid4()}",
            "label": "语音识别测试模型",
            "description": "",
            "capabilities": [capability],
            "categories": [capability] if capability != "chat" else ["text_generation"],
            "enabled": True,
        },
    )
    assert model_response.status_code == 200, model_response.text
    return provider, model_response.json()["model"]


async def _delete_provider(client: httpx.AsyncClient, provider_id: str) -> None:
    revision = (await client.get("/v1/model-providers")).json()["revision"]
    response = await client.delete(
        f"/v1/model-providers/{provider_id}",
        params={"expected_catalog_revision": revision},
    )
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_transcription_upload_formats_runner_segments_logs_and_cas_cleanup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict] = []

    async def fake_transcribe(**kwargs) -> TranscriptionResult:
        calls.append(kwargs)
        return TranscriptionResult(
            text="你好，欢迎收听。",
            segments=(
                TranscriptSegment("speaker_0", 0, 1200, "你好。"),
                TranscriptSegment(
                    "speaker_1",
                    1200,
                    2450,
                    "欢迎收听。",
                    translation="Welcome.",
                    speaker_candidates=("speaker_1", "speaker_2"),
                    is_overlap=True,
                ),
            ),
            words=(TranscriptWord("你好", 0, 600),),
            detail={
                "processing_status": "degraded",
                "warnings": [
                    {
                        "stage": "diarization",
                        "code": "speaker_fallback",
                        "message": "说话人识别已降级",
                    }
                ],
            },
        )

    monkeypatch.setattr(
        "app.llm.playground.transcription_runner.transcribe_model_audio",
        fake_transcribe,
    )
    samples = [
        ("voice.mp3", b"ID3" + b"a" * (10 * 1024 * 1024 - 3), "audio/mpeg"),
        ("voice.wav", b"RIFF\x00\x00\x00\x00WAVEtest-audio", "audio/wav"),
        ("voice.m4a", b"\x00\x00\x00\x18ftypM4A test-audio", "audio/mp4"),
        ("voice.ogg", b"OggStest-audio", "audio/ogg"),
    ]
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        provider, model = await _create_asr_model(client)
        options = (await client.get("/v1/model-test/transcription-options")).json()
        assert options["max_input_bytes"] == 10 * 1024 * 1024
        assert options["accepted_extensions"] == [".mp3", ".wav", ".m4a", ".ogg"]
        option = next(item for item in options["items"] if item["id"] == model["id"])
        assert option["max_input_bytes"] == 10 * 1024 * 1024
        assert option["parameter_capabilities"]["supports_punctuation"] is True
        assert option["parameter_capabilities"]["defaults"]["enable_punctuation"] is True

        task_ids: list[str] = []
        for filename, content, mime_type in samples:
            response = await client.post(
                "/v1/model-test/transcription-tasks/upload",
                data={"model_id": model["id"], "language": "zh"},
                files={"upload": (filename, content, mime_type)},
            )
            assert response.status_code == 200, response.text
            task = response.json()
            assert task["status"] == "queued"
            assert task["source"]["filename"] == filename
            assert task["source"]["available"] is True
            task_ids.append(task["id"])

        other_workspace_id = str(uuid4())
        async with SessionLocal() as session:
            session.add(Workspace(id=other_workspace_id, name="隔离测试空间"))
            await session.commit()
        async with SessionLocal() as session:
            bind_workspace(session, other_workspace_id)
            with pytest.raises(ModelTestTranscriptionError, match="不存在"):
                await ModelTestTranscription(session).get(task_ids[0])

        mismatch = await client.post(
            "/v1/model-test/transcription-tasks/upload",
            data={"model_id": model["id"], "language": "auto"},
            files={"upload": ("fake.mp3", b"not-an-mp3", "audio/mpeg")},
        )
        assert mismatch.status_code == 422
        assert mismatch.json()["code"] == "invalid_file_content"
        mime_mismatch = await client.post(
            "/v1/model-test/transcription-tasks/upload",
            data={"model_id": model["id"], "language": "auto"},
            files={"upload": ("fake.wav", b"RIFF\x00\x00\x00\x00WAVE", "audio/ogg")},
        )
        assert mime_mismatch.status_code == 422
        assert mime_mismatch.json()["code"] == "file_type_mismatch"
        empty = await client.post(
            "/v1/model-test/transcription-tasks/upload",
            data={"model_id": model["id"], "language": "auto"},
            files={"upload": ("empty.wav", b"", "audio/wav")},
        )
        assert empty.status_code == 422
        assert empty.json()["code"] == "empty_file"
        oversized = await client.post(
            "/v1/model-test/transcription-tasks/upload",
            data={"model_id": model["id"], "language": "auto"},
            files={
                "upload": (
                    "large.mp3",
                    b"ID3" + b"a" * (10 * 1024 * 1024),
                    "audio/mpeg",
                )
            },
        )
        assert oversized.status_code == 413
        assert oversized.json()["code"] == "file_too_large"

        await ModelTestTranscriptionRunner().process_once()
        assert len(calls) == 4
        assert all(call["language"] == "zh" for call in calls)
        assert all(call["parameters"]["enable_punctuation"] is True for call in calls)
        assert all(call["parameters"]["enable_speaker_diarization"] is True for call in calls)
        for task_id in task_ids:
            completed = (await client.get(f"/v1/model-test/transcription-tasks/{task_id}")).json()
            assert completed["status"] == "completed"
            assert completed["result_text"] == "你好，欢迎收听。"
            assert completed["result_segments"][1] == {
                "speaker": "speaker_1",
                "start_ms": 1200,
                "end_ms": 2450,
                "text": "欢迎收听。",
                "translation": "Welcome.",
                "speaker_candidates": ["speaker_1", "speaker_2"],
                "is_overlap": True,
            }
            assert completed["parameters"]["language"] == "zh"
            assert completed["parameters"]["enable_punctuation"] is True
            assert completed["result_detail"]["words"] == [
                {"word": "你好", "start_ms": 0, "end_ms": 600}
            ]
            assert completed["result_detail"]["processing_status"] == "degraded"
            log = (await client.get(f"/v1/llm-call-logs/{completed['log_id']}")).json()
            assert log["call_source"] == "model_playground"
            assert log["response_payload"]["content"] == "你好，欢迎收听。"
            assert log["request_payload"]["parameters"] == completed["parameters"]
            assert log["response_payload"]["detail"] == completed["result_detail"]
            assert "transcription-test-secret" not in str(log)
            assert "input_storage_key" not in str(log)

            stale = await client.delete(
                f"/v1/model-test/transcription-tasks/{task_id}",
                params={"expected_revision": completed["revision"] - 1},
            )
            assert stale.status_code == 409
            deleted = await client.delete(
                f"/v1/model-test/transcription-tasks/{task_id}",
                params={"expected_revision": completed["revision"]},
            )
            assert deleted.status_code == 200
            assert (
                await client.get(f"/v1/model-test/transcription-tasks/{task_id}/input-content")
            ).status_code == 404
            await client.delete(f"/v1/llm-call-logs/{completed['log_id']}")
        await _delete_provider(client, provider["id"])
        async with SessionLocal() as session:
            workspace = await session.get(Workspace, other_workspace_id)
            assert workspace is not None
            await session.delete(workspace)
            await session.commit()


@pytest.mark.asyncio
async def test_pro_asr_accepts_100_mb_model_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict] = []

    async def fake_transcribe(**kwargs) -> TranscriptionResult:
        calls.append(kwargs)
        return TranscriptionResult(text="专业语音识别完成")

    monkeypatch.setattr(
        "app.llm.playground.transcription_runner.transcribe_model_audio",
        fake_transcribe,
    )
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        provider, model = await _create_asr_model(
            client,
            base_url="http://180.184.148.131:30002/api/v2/asr/pro",
        )
        options = (await client.get("/v1/model-test/transcription-options")).json()
        option = next(item for item in options["items"] if item["id"] == model["id"])
        assert option["max_input_bytes"] == 100 * 1024 * 1024
        assert option["parameter_capabilities"]["language_mode"] == "candidates"
        assert option["parameter_capabilities"]["defaults"]["enable_text_edit"] is True

        invalid_language = await client.post(
            "/v1/model-test/transcription-tasks/upload",
            data={"model_id": model["id"], "language": "Chinese,Klingon"},
            files={"upload": ("invalid.mp3", b"ID3invalid", "audio/mpeg")},
        )
        assert invalid_language.status_code == 422
        assert invalid_language.json()["code"] == "invalid_transcription_parameters"
        assert "语言候选" in invalid_language.text

        invalid_max_speakers = await client.post(
            "/v1/model-test/transcription-tasks/upload",
            data={"model_id": model["id"], "language": "Chinese", "max_speakers": "2"},
            files={"upload": ("invalid.mp3", b"ID3invalid", "audio/mpeg")},
        )
        assert invalid_max_speakers.status_code == 422
        assert "max_speakers" in invalid_max_speakers.text

        response = await client.post(
            "/v1/model-test/transcription-tasks/upload",
            data={
                "model_id": model["id"],
                "language": "Chinese,English",
                "target_language": "Japanese",
                "enable_word_timestamps": "true",
                "enable_text_edit": "false",
                "enable_speaker_diarization": "false",
            },
            files={
                "upload": (
                    "long-recording.mp3",
                    b"ID3" + b"a" * (10 * 1024 * 1024),
                    "audio/mpeg",
                )
            },
        )
        assert response.status_code == 200, response.text
        task = response.json()
        assert task["source"]["byte_size"] > 10 * 1024 * 1024
        assert task["parameters"] == {
            "language": "Chinese,English",
            "target_language": "Japanese",
            "enable_word_timestamps": True,
            "enable_text_edit": False,
            "enable_speaker_diarization": False,
            "max_speakers": None,
            "enable_punctuation": False,
            "hotwords": None,
            "abbreviations": False,
        }

        await ModelTestTranscriptionRunner().process_once()
        assert calls[0]["parameters"] == task["parameters"]
        completed = (await client.get(f"/v1/model-test/transcription-tasks/{task['id']}")).json()
        assert completed["status"] == "completed"
        assert completed["result_text"] == "专业语音识别完成"
        await client.delete(
            f"/v1/model-test/transcription-tasks/{task['id']}",
            params={"expected_revision": completed["revision"]},
        )
        await client.delete(f"/v1/llm-call-logs/{completed['log_id']}")
        await _delete_provider(client, provider["id"])


@pytest.mark.asyncio
async def test_transcription_library_source_is_private_and_survives_source_deletion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_transcribe(**_kwargs) -> TranscriptionResult:
        return TranscriptionResult(text="来自文件管理的转写")

    monkeypatch.setattr(
        "app.llm.playground.transcription_runner.transcribe_model_audio",
        fake_transcribe,
    )
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        provider, model = await _create_asr_model(client, kind="openai")
        uploaded = await client.post(
            "/v1/files",
            files={"upload": ("library.ogg", b"OggSlibrary-audio", "audio/ogg")},
        )
        assert uploaded.status_code == 200, uploaded.text
        asset = uploaded.json()
        created = await client.post(
            "/v1/model-test/transcription-tasks",
            json={
                "model_id": model["id"],
                "source_asset_id": asset["id"],
                "language": "ja",
            },
        )
        assert created.status_code == 200, created.text
        task = created.json()
        assert task["source"]["kind"] == "library"
        assert task["source"]["source_asset_id"] == asset["id"]

        deleted_source = await client.delete(
            f"/v1/files/{asset['id']}",
            params={"expected_revision": asset["revision"]},
        )
        assert deleted_source.status_code == 200, deleted_source.text
        after_source_delete = (
            await client.get(f"/v1/model-test/transcription-tasks/{task['id']}")
        ).json()
        assert after_source_delete["source"]["source_asset_id"] is None
        content = await client.get(f"/v1/model-test/transcription-tasks/{task['id']}/input-content")
        assert content.status_code == 200
        assert content.content == b"OggSlibrary-audio"

        await ModelTestTranscriptionRunner().process_once()
        completed = (await client.get(f"/v1/model-test/transcription-tasks/{task['id']}")).json()
        assert completed["status"] == "completed"
        assert completed["result_text"] == "来自文件管理的转写"
        assert completed["result_segments"] == []
        await client.delete(
            f"/v1/model-test/transcription-tasks/{task['id']}",
            params={"expected_revision": completed["revision"]},
        )
        await client.delete(f"/v1/llm-call-logs/{completed['log_id']}")
        await _delete_provider(client, provider["id"])


@pytest.mark.asyncio
async def test_transcription_recovery_marks_running_task_failed_and_logs_it() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        provider, model = await _create_asr_model(client)
        created = await client.post(
            "/v1/model-test/transcription-tasks/upload",
            data={"model_id": model["id"], "language": "auto"},
            files={"upload": ("interrupted.mp3", b"ID3interrupted", "audio/mpeg")},
        )
        task = created.json()

        async with SessionLocal() as session:
            row = await session.scalar(
                select(ModelTestTranscriptionTask).where(
                    ModelTestTranscriptionTask.id == task["id"]
                )
            )
            assert row is not None
            row.status = "running"
            row.revision += 1
            await session.commit()

        await ModelTestTranscriptionRunner().recover()
        failed = (await client.get(f"/v1/model-test/transcription-tasks/{task['id']}")).json()
        assert failed["status"] == "failed"
        assert "避免重复计费" in failed["error_message"]
        assert failed["log_id"]
        await client.delete(
            f"/v1/model-test/transcription-tasks/{task['id']}",
            params={"expected_revision": failed["revision"]},
        )
        await client.delete(f"/v1/llm-call-logs/{failed['log_id']}")
        await _delete_provider(client, provider["id"])


@pytest.mark.asyncio
async def test_transcription_rejects_model_without_key_and_chat_only_model() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        provider, model = await _create_asr_model(client, with_key=False)
        response = await client.post(
            "/v1/model-test/transcription-tasks/upload",
            data={"model_id": model["id"], "language": "auto"},
            files={"upload": ("voice.mp3", b"ID3voice", "audio/mpeg")},
        )
        assert response.status_code == 409
        assert response.json()["code"] == "missing_api_key"
        await _delete_provider(client, provider["id"])

        chat_provider, chat_model = await _create_asr_model(
            client, kind="openai", capability="chat"
        )
        options = (await client.get("/v1/model-test/transcription-options")).json()
        assert all(item["id"] != chat_model["id"] for item in options["items"])
        await _delete_provider(client, chat_provider["id"])
