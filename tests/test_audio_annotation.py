from __future__ import annotations

import io
import wave
from uuid import uuid4

import httpx
import pytest
from tests.account_fixtures import account_record

from app.apps.audio_annotation.projects import AudioAnnotationError, AudioAnnotationProjects
from app.capabilities.transcription.support import (
    resolve_transcription_language,
    resolve_transcription_target_language,
)
from app.console.models import User
from app.llm.models import ModelEntry, ModelProvider, ModelTestTranscriptionTask
from app.llm.providers.transcription import TranscriptionResult, TranscriptSegment
from app.main import app
from app.orm import bind_owner
from app.runtime.config import get_settings
from app.runtime.db import SessionLocal


def wav_bytes(seconds: float = 1.0) -> bytes:
    target = io.BytesIO()
    with wave.open(target, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(8000)
        audio.writeframes(b"\x00\x00" * round(8000 * seconds))
    return target.getvalue()


async def upload_audio(client: httpx.AsyncClient, name: str = "annotation.wav") -> dict:
    response = await client.post(
        "/v1/files",
        files={"upload": (name, wav_bytes(), "audio/wav")},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def create_asr_model(client: httpx.AsyncClient) -> tuple[dict, dict]:
    catalog = (await client.get("/v1/model-providers")).json()
    provider_response = await client.post(
        "/v1/model-providers",
        json={
            "expected_catalog_revision": catalog["revision"],
            "name": f"annotation-asr-{uuid4()}",
            "kind": "senseaudio_asr",
            "base_url": "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription",
            "api_key": "annotation-secret",
            "enabled": True,
        },
    )
    assert provider_response.status_code == 200, provider_response.text
    provider_body = provider_response.json()
    model_response = await client.post(
        f"/v1/model-providers/{provider_body['provider']['id']}/models",
        json={
            "expected_catalog_revision": provider_body["revision"],
            "slug": f"senseaudio-asr-pro-{uuid4()}",
            "label": "标注片段识别模型",
            "description": "",
            "capabilities": ["speech_recognition"],
            "categories": ["speech_recognition"],
            "enabled": True,
        },
    )
    assert model_response.status_code == 200, model_response.text
    return provider_body["provider"], model_response.json()["model"]


async def seed_transcription_task(
    *,
    filename: str = "recognized.wav",
    status: str = "completed",
    source_asset_id: str | None = None,
    text: str = "识别全文",
    segments: list[dict] | None = None,
    owner_user_id: str = "test-user",
    write_private_audio: bool = True,
) -> str:
    storage_key = uuid4().hex
    content = wav_bytes()
    path = get_settings().account_model_test_path(owner_user_id, "references") / storage_key
    if write_private_audio:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    async with SessionLocal() as session:
        bind_owner(session, owner_user_id)
        row = ModelTestTranscriptionTask(
            owner_user_id=owner_user_id,
            provider_kind="openai",
            provider_name="测试识别供应商",
            model_slug="test-asr",
            source_kind="library" if source_asset_id else "upload",
            source_asset_id=source_asset_id,
            input_storage_key=storage_key,
            input_filename=filename,
            input_mime_type="audio/wav",
            input_byte_size=len(content),
            language="zh",
            status=status,
            result_text=text if status == "completed" else None,
            result_segments=segments or [],
        )
        session.add(row)
        await session.commit()
        return row.id


@pytest.mark.asyncio
async def test_audio_annotation_project_document_waveform_and_asset_guard() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        asset = await upload_audio(client)
        created = await client.post(
            "/v1/audio-annotation/projects",
            json={"title": "访谈标注", "asset_id": asset["id"]},
        )
        assert created.status_code == 200, created.text
        project = created.json()
        assert 900 <= project["duration_ms"] <= 1100
        assert project["segment_count"] == 1
        assert project["waveform_ready"] is False

        document_response = await client.get(
            f"/v1/audio-annotation/projects/{project['id']}/document"
        )
        assert document_response.status_code == 200
        document = document_response.json()
        assert document["schema_version"] == "1.0"
        assert document["segments"][0]["start_ms"] == 0
        assert document["segments"][0]["end_ms"] == project["duration_ms"]

        saved = await client.put(
            f"/v1/audio-annotation/projects/{project['id']}/document",
            json={
                "expected_revision": document["revision"],
                "schema_version": "1.0",
                "speakers": [{"id": "speaker-host", "name": "主持人", "color": "#28B8A7"}],
                "segments": [
                    {
                        "id": "segment-1",
                        "start_ms": 0,
                        "end_ms": 500,
                        "speaker_id": "speaker-host",
                        "emotion": "  克制的兴奋  ",
                        "text": "大丈夫。",
                        "language": "ja",
                        "localized_texts": [
                            {"language": "zh", "text": "没问题。"},
                            {"language": "en", "text": "Don't worry."},
                        ],
                        "status": "reviewed",
                    }
                ],
            },
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["revision"] == 1
        assert saved.json()["custom_emotions"] == []
        assert saved.json()["segments"][0]["speaker_ids"] == ["speaker-host"]
        assert saved.json()["segments"][0]["emotion"] == "克制的兴奋"
        assert saved.json()["segments"][0]["speaker_emotions"] == [
            {"speaker_id": "speaker-host", "emotion": "克制的兴奋"}
        ]
        assert saved.json()["segments"][0]["language"] == "ja"
        assert saved.json()["segments"][0]["localized_texts"] == [
            {"language": "zh", "text": "没问题。"},
            {"language": "en", "text": "Don't worry."},
        ]

        with_vocab = await client.put(
            f"/v1/audio-annotation/projects/{project['id']}/document",
            json={
                "expected_revision": saved.json()["revision"],
                "schema_version": "1.0",
                "speakers": [{"id": "speaker-host", "name": "主持人", "color": "#28B8A7"}],
                "custom_emotions": [" 克制的兴奋 ", "咬牙切齿"],
                "segments": [
                    {
                        "id": "segment-1",
                        "start_ms": 0,
                        "end_ms": 500,
                        "speaker_id": "speaker-host",
                        "emotion": "克制的兴奋",
                        "text": "大丈夫。",
                        "status": "reviewed",
                    }
                ],
            },
        )
        assert with_vocab.status_code == 200, with_vocab.text
        assert with_vocab.json()["custom_emotions"] == [
            {"name": "克制的兴奋", "color": "#28B8A7"},
            {"name": "咬牙切齿", "color": "#4C8FE8"},
        ]

        duplicate_vocab = await client.put(
            f"/v1/audio-annotation/projects/{project['id']}/document",
            json={
                "expected_revision": with_vocab.json()["revision"],
                "schema_version": "1.0",
                "speakers": [],
                "custom_emotions": ["开心", "开心"],
                "segments": [
                    {
                        "id": "segment-1",
                        "start_ms": 0,
                        "end_ms": 500,
                        "text": "",
                        "status": "draft",
                    }
                ],
            },
        )
        assert duplicate_vocab.status_code == 422

        invalid_emotion = await client.put(
            f"/v1/audio-annotation/projects/{project['id']}/document",
            json={
                "expected_revision": with_vocab.json()["revision"],
                "schema_version": "1.0",
                "speakers": [],
                "segments": [
                    {
                        "id": "emotion-too-long",
                        "start_ms": 0,
                        "end_ms": 500,
                        "emotion": "很" * 41,
                        "text": "",
                        "status": "draft",
                    }
                ],
            },
        )
        assert invalid_emotion.status_code == 422

        per_speaker = await client.put(
            f"/v1/audio-annotation/projects/{project['id']}/document",
            json={
                "expected_revision": with_vocab.json()["revision"],
                "schema_version": "1.0",
                "speakers": [
                    {"id": "speaker-host", "name": "主持人", "color": "#28B8A7"},
                    {"id": "speaker-guest", "name": "嘉宾", "color": "#4C8FE8"},
                ],
                "custom_emotions": ["克制的兴奋", "咬牙切齿"],
                "segments": [
                    {
                        "id": "segment-1",
                        "start_ms": 0,
                        "end_ms": 500,
                        "speaker_ids": ["speaker-host", "speaker-guest"],
                        "speaker_emotions": [
                            {"speaker_id": "speaker-host", "emotion": "开心"},
                            {"speaker_id": "speaker-guest", "emotion": "平静"},
                        ],
                        "text": "大丈夫。",
                        "language": "ja",
                        "localized_texts": [],
                        "status": "draft",
                    }
                ],
            },
        )
        assert per_speaker.status_code == 200, per_speaker.text
        assert per_speaker.json()["segments"][0]["emotion"] is None
        assert per_speaker.json()["segments"][0]["speaker_emotions"] == [
            {"speaker_id": "speaker-host", "emotion": "开心"},
            {"speaker_id": "speaker-guest", "emotion": "平静"},
        ]
        assert per_speaker.json()["custom_emotions"] == [
            {"name": "克制的兴奋", "color": "#28B8A7"},
            {"name": "咬牙切齿", "color": "#4C8FE8"},
        ]

        invalid_binding = await client.put(
            f"/v1/audio-annotation/projects/{project['id']}/document",
            json={
                "expected_revision": per_speaker.json()["revision"],
                "schema_version": "1.0",
                "speakers": [{"id": "speaker-host", "name": "主持人", "color": "#28B8A7"}],
                "segments": [
                    {
                        "id": "segment-1",
                        "start_ms": 0,
                        "end_ms": 500,
                        "speaker_ids": ["speaker-host"],
                        "speaker_emotions": [
                            {"speaker_id": "missing", "emotion": "开心"},
                        ],
                        "text": "",
                        "status": "draft",
                    }
                ],
            },
        )
        assert invalid_binding.status_code == 422

        conflict = await client.put(
            f"/v1/audio-annotation/projects/{project['id']}/document",
            json={
                "expected_revision": 0,
                "schema_version": "1.0",
                "speakers": [],
                "segments": [],
            },
        )
        assert conflict.status_code == 409
        assert conflict.json()["current_revision"] == 3

        overlapping = await client.put(
            f"/v1/audio-annotation/projects/{project['id']}/document",
            json={
                "expected_revision": 3,
                "schema_version": "1.0",
                "speakers": [
                    {"id": "speaker-a", "name": "说话人 A", "color": "#28B8A7"},
                    {"id": "speaker-b", "name": "说话人 B", "color": "#4C8FE8"},
                ],
                "segments": [
                    {
                        "id": "one",
                        "start_ms": 0,
                        "end_ms": 500,
                        "speaker_id": "speaker-a",
                        "speaker_ids": ["speaker-a", "speaker-b"],
                        "text": "",
                        "status": "draft",
                    },
                    {
                        "id": "two",
                        "start_ms": 400,
                        "end_ms": 700,
                        "speaker_id": "speaker-b",
                        "text": "",
                        "status": "draft",
                    },
                ],
            },
        )
        assert overlapping.status_code == 200, overlapping.text
        assert overlapping.json()["segments"][1]["start_ms"] == 400
        assert overlapping.json()["segments"][0]["speaker_ids"] == [
            "speaker-a",
            "speaker-b",
        ]

        unknown_secondary_speaker = await client.put(
            f"/v1/audio-annotation/projects/{project['id']}/document",
            json={
                "expected_revision": overlapping.json()["revision"],
                "schema_version": "1.0",
                "speakers": [{"id": "speaker-a", "name": "说话人 A", "color": "#28B8A7"}],
                "segments": [
                    {
                        "id": "unknown-secondary",
                        "start_ms": 0,
                        "end_ms": 500,
                        "speaker_ids": ["speaker-a", "missing"],
                        "text": "",
                        "status": "draft",
                    }
                ],
            },
        )
        assert unknown_secondary_speaker.status_code == 422
        assert unknown_secondary_speaker.json()["code"] == "speaker_not_found"

        too_short = await client.put(
            f"/v1/audio-annotation/projects/{project['id']}/document",
            json={
                "expected_revision": overlapping.json()["revision"],
                "schema_version": "1.0",
                "speakers": [],
                "segments": [
                    {
                        "id": "too-short",
                        "start_ms": 0,
                        "end_ms": 99,
                        "speaker_id": None,
                        "text": "",
                        "status": "draft",
                    }
                ],
            },
        )
        assert too_short.status_code == 422
        assert too_short.json()["code"] == "segment_too_short"

        duplicate_language = await client.put(
            f"/v1/audio-annotation/projects/{project['id']}/document",
            json={
                "expected_revision": overlapping.json()["revision"],
                "schema_version": "1.0",
                "speakers": [],
                "segments": [
                    {
                        "id": "duplicate-language",
                        "start_ms": 0,
                        "end_ms": 500,
                        "speaker_id": None,
                        "text": "大丈夫。",
                        "language": "ja",
                        "localized_texts": [
                            {"language": "ja", "text": "重复版本"},
                        ],
                        "status": "draft",
                    }
                ],
            },
        )
        assert duplicate_language.status_code == 422

        waveform = await client.put(
            f"/v1/audio-annotation/projects/{project['id']}/waveform",
            json={
                "expected_revision": 0,
                "duration_ms": project["duration_ms"],
                "peaks": [[-0.5, 0.25, 1.0]],
            },
        )
        assert waveform.status_code == 200, waveform.text
        assert waveform.json()["revision"] == 1

        in_use = await client.delete(
            f"/v1/files/{asset['id']}",
            params={"expected_revision": asset["revision"]},
        )
        assert in_use.status_code == 409
        assert in_use.json()["code"] == "asset_in_use"

        removed = await client.delete(
            f"/v1/audio-annotation/projects/{project['id']}",
            params={"expected_revision": project["revision"]},
        )
        assert removed.status_code == 200
        removed_asset = await client.delete(
            f"/v1/files/{asset['id']}",
            params={"expected_revision": asset["revision"]},
        )
        assert removed_asset.status_code == 200, removed_asset.text


@pytest.mark.asyncio
async def test_audio_annotation_transcribes_selected_range_to_target_language_and_logs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict] = []

    async def fake_transcribe(**kwargs) -> TranscriptionResult:
        kwargs["source_head"] = kwargs["source"].read(4)
        kwargs["source"].seek(0)
        calls.append(kwargs)
        if kwargs["parameters"]["target_language"]:
            return TranscriptionResult(
                text="  Original transcription.  ",
                segments=(
                    TranscriptSegment(
                        speaker="speaker",
                        start_ms=0,
                        end_ms=1000,
                        text="Original transcription.",
                        translation="  片段翻译完成。  ",
                    ),
                ),
            )
        return TranscriptionResult(text="  日本語の書き起こし。  ")

    monkeypatch.setattr(
        "app.apps.audio_annotation.transcription.transcribe_model_audio",
        fake_transcribe,
    )
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        provider, model = await create_asr_model(client)
        asset = await upload_audio(client, "segment-source.wav")
        project = (
            await client.post(
                "/v1/audio-annotation/projects",
                json={"title": "片段转写", "asset_id": asset["id"]},
            )
        ).json()

        response = await client.post(
            f"/v1/audio-annotation/projects/{project['id']}/segment-transcriptions",
            data={
                "model_id": model["id"],
                "segment_id": "segment-one",
                "start_ms": "0",
                "end_ms": "1000",
                "language_tag": "ja-JP",
                "target_language_tag": "zh-CN",
            },
            files={"upload": ("segment.wav", wav_bytes(), "audio/wav")},
        )
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["text"] == "片段翻译完成。"
        assert result["requested_language"] == "ja-JP"
        assert result["resolved_language"] == "ja"
        assert result["requested_target_language"] == "zh-CN"
        assert result["resolved_target_language"] == "zh"
        assert calls[0]["language"] == "ja"
        assert calls[0]["parameters"]["target_language"] == "zh"
        assert calls[0]["filename"] == "segment-segment-one.wav"
        assert calls[0]["source_head"] == b"RIFF"

        log = await client.get(f"/v1/llm-call-logs/{result['log_id']}")
        assert log.status_code == 200, log.text
        assert log.json()["call_source"] == "audio_annotation"
        assert log.json()["request_payload"]["segment_id"] == "segment-one"
        assert log.json()["request_payload"]["language"] == "ja"
        assert log.json()["request_payload"]["target_language"] == "zh"

        original = await client.post(
            f"/v1/audio-annotation/projects/{project['id']}/segment-transcriptions",
            data={
                "model_id": model["id"],
                "segment_id": "segment-two",
                "start_ms": "0",
                "end_ms": "1000",
                "language_tag": "ja-JP",
            },
            files={"upload": ("segment.wav", wav_bytes(), "audio/wav")},
        )
        assert original.status_code == 200, original.text
        assert original.json()["text"] == "日本語の書き起こし。"
        assert original.json()["resolved_language"] == "ja"
        assert original.json()["resolved_target_language"] is None
        assert calls[1]["language"] == "ja"
        assert calls[1]["parameters"]["target_language"] is None

        automatic = await client.post(
            f"/v1/audio-annotation/projects/{project['id']}/segment-transcriptions",
            data={
                "model_id": model["id"],
                "segment_id": "segment-auto",
                "start_ms": "0",
                "end_ms": "1000",
            },
            files={"upload": ("segment.wav", wav_bytes(), "audio/wav")},
        )
        assert automatic.status_code == 200, automatic.text
        assert automatic.json()["resolved_language"] == "auto"
        assert automatic.json()["resolved_target_language"] is None
        assert calls[2]["language"] == "auto"

        unsupported_target = await client.post(
            f"/v1/audio-annotation/projects/{project['id']}/segment-transcriptions",
            data={
                "model_id": model["id"],
                "segment_id": "segment-unsupported-target",
                "start_ms": "0",
                "end_ms": "1000",
                "target_language_tag": "xx-ZZ",
            },
            files={"upload": ("segment.wav", wav_bytes(), "audio/wav")},
        )
        assert unsupported_target.status_code == 409
        assert unsupported_target.json()["code"] == "target_language_unsupported"

        async def incomplete_translation(**_kwargs) -> TranscriptionResult:
            return TranscriptionResult(
                text="English source text.",
                segments=(
                    TranscriptSegment(
                        speaker="speaker",
                        start_ms=0,
                        end_ms=1000,
                        text="English source text.",
                    ),
                ),
            )

        monkeypatch.setattr(
            "app.apps.audio_annotation.transcription.transcribe_model_audio",
            incomplete_translation,
        )
        untranslated = await client.post(
            f"/v1/audio-annotation/projects/{project['id']}/segment-transcriptions",
            data={
                "model_id": model["id"],
                "segment_id": "segment-untranslated",
                "start_ms": "0",
                "end_ms": "1000",
                "language_tag": "ja",
                "target_language_tag": "zh",
            },
            files={"upload": ("segment.wav", wav_bytes(), "audio/wav")},
        )
        assert untranslated.status_code == 502
        assert untranslated.json()["detail"] == "语音识别供应商未返回完整的目标语言译文"

        async def failing_transcribe(**_kwargs) -> TranscriptionResult:
            raise httpx.ReadTimeout("timed out")

        monkeypatch.setattr(
            "app.apps.audio_annotation.transcription.transcribe_model_audio",
            failing_transcribe,
        )
        failed = await client.post(
            f"/v1/audio-annotation/projects/{project['id']}/segment-transcriptions",
            data={
                "model_id": model["id"],
                "segment_id": "segment-failed",
                "start_ms": "0",
                "end_ms": "1000",
            },
            files={"upload": ("segment.wav", wav_bytes(), "audio/wav")},
        )
        assert failed.status_code == 502
        assert failed.json()["detail"] == "语音识别请求超时"
        error_logs = await client.get(
            "/v1/llm-call-logs",
            params={"call_source": "audio_annotation", "status": "error"},
        )
        assert error_logs.status_code == 200, error_logs.text
        assert error_logs.json()["items"][0]["model"] == model["slug"]

        async def empty_transcribe(**_kwargs) -> TranscriptionResult:
            return TranscriptionResult(text="   ")

        monkeypatch.setattr(
            "app.apps.audio_annotation.transcription.transcribe_model_audio",
            empty_transcribe,
        )
        empty = await client.post(
            f"/v1/audio-annotation/projects/{project['id']}/segment-transcriptions",
            data={
                "model_id": model["id"],
                "segment_id": "segment-empty",
                "start_ms": "0",
                "end_ms": "1000",
            },
            files={"upload": ("segment.wav", wav_bytes(), "audio/wav")},
        )
        assert empty.status_code == 200, empty.text
        assert empty.json()["text"] == ""
        empty_log = await client.get(f"/v1/llm-call-logs/{empty.json()['log_id']}")
        assert empty_log.status_code == 200, empty_log.text
        assert empty_log.json()["status"] == "success"

        mismatch = await client.post(
            f"/v1/audio-annotation/projects/{project['id']}/segment-transcriptions",
            data={
                "model_id": model["id"],
                "segment_id": "segment-three",
                "start_ms": "0",
                "end_ms": "500",
            },
            files={"upload": ("segment.wav", wav_bytes(), "audio/wav")},
        )
        assert mismatch.status_code == 422
        assert mismatch.json()["code"] == "segment_audio_duration_mismatch"

        invalid = await client.post(
            f"/v1/audio-annotation/projects/{project['id']}/segment-transcriptions",
            data={
                "model_id": model["id"],
                "segment_id": "segment-four",
                "start_ms": "0",
                "end_ms": "1000",
            },
            files={"upload": ("segment.wav", b"not-wave", "audio/wav")},
        )
        assert invalid.status_code == 422
        assert invalid.json()["code"] == "invalid_segment_audio"

        assert (
            await client.delete(
                f"/v1/audio-annotation/projects/{project['id']}",
                params={"expected_revision": project["revision"]},
            )
        ).status_code == 200
        assert (
            await client.delete(
                f"/v1/files/{asset['id']}",
                params={"expected_revision": asset["revision"]},
            )
        ).status_code == 200
        catalog_revision = (await client.get("/v1/model-providers")).json()["revision"]
        assert (
            await client.delete(
                f"/v1/model-providers/{provider['id']}",
                params={"expected_catalog_revision": catalog_revision},
            )
        ).status_code == 200


def test_transcription_language_supports_pro_aliases_and_auto_fallback() -> None:
    provider = ModelProvider(
        owner_user_id="test-user",
        id="provider",
        name="Pro ASR",
        kind="senseaudio_asr_pro",
        base_url="https://asr.example/api/v2/asr/pro",
        enabled=True,
    )
    model = ModelEntry(
        owner_user_id="test-user",
        id="model",
        provider_id=provider.id,
        slug="pro-asr",
        capabilities=["speech_recognition"],
        categories=["speech_recognition"],
        enabled=True,
    )
    assert resolve_transcription_language(model, provider, "ja-JP") == "Japanese"
    assert resolve_transcription_language(model, provider, "fr-CA") == "French"
    assert resolve_transcription_language(model, provider, "yue-HK") == "auto"
    assert resolve_transcription_target_language(model, provider, "zh-CN") == "Chinese"
    assert resolve_transcription_target_language(model, provider, "ja-JP") == "Japanese"
    assert resolve_transcription_target_language(model, provider, "yue-HK") is None


@pytest.mark.asyncio
async def test_audio_annotation_import_is_atomic_and_searchable() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        asset = await upload_audio(client, "import-annotation.wav")
        imported = await client.post(
            "/v1/audio-annotation/imports",
            json={
                "title": "导入的标注任务",
                "asset_id": asset["id"],
                "schema_version": "1.0",
                "speakers": [{"id": "guest", "name": "嘉宾", "color": "#8B5CF6"}],
                "segments": [
                    {
                        "id": "answer",
                        "start_ms": 100,
                        "end_ms": 800,
                        "speaker_id": "guest",
                        "text": "这是导入的内容。",
                        "status": "reviewed",
                    }
                ],
            },
        )
        assert imported.status_code == 200, imported.text
        project = imported.json()
        assert project["reviewed_segment_count"] == 1

        listed = await client.get("/v1/audio-annotation/projects", params={"query": "导入的"})
        assert [item["id"] for item in listed.json()["items"]] == [project["id"]]

        invalid = await client.post(
            "/v1/audio-annotation/imports",
            json={
                "title": "越界任务",
                "asset_id": asset["id"],
                "schema_version": "1.0",
                "speakers": [],
                "segments": [
                    {
                        "id": "outside",
                        "start_ms": 0,
                        "end_ms": 2000,
                        "speaker_id": None,
                        "text": "",
                        "status": "draft",
                    }
                ],
            },
        )
        assert invalid.status_code == 422
        listed_after = await client.get(
            "/v1/audio-annotation/projects", params={"query": "越界任务"}
        )
        assert listed_after.json()["items"] == []

        assert (
            await client.delete(
                f"/v1/audio-annotation/projects/{project['id']}",
                params={"expected_revision": project["revision"]},
            )
        ).status_code == 200
        assert (
            await client.delete(
                f"/v1/files/{asset['id']}",
                params={"expected_revision": asset["revision"]},
            )
        ).status_code == 200


@pytest.mark.asyncio
async def test_transcription_task_import_clones_private_audio_and_preserves_segments() -> None:
    task_id = await seed_transcription_task(
        filename="episode.wav",
        segments=[
            {
                "speaker": "SPK_0",
                "start_ms": 0,
                "end_ms": 400,
                "text": "第一句。",
                "translation": "First sentence.",
            },
            {
                "speaker": "unknown",
                "start_ms": 400,
                "end_ms": 900,
                "text": "第二句。",
            },
        ],
    )
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        imported = await client.post(
            "/v1/audio-annotation/transcription-imports",
            json={"source_kind": "task", "task_id": task_id},
        )
        assert imported.status_code == 200, imported.text
        project = imported.json()
        assert project["title"] == "episode"
        assert project["original_filename"] == "episode.wav"

        document = (
            await client.get(f"/v1/audio-annotation/projects/{project['id']}/document")
        ).json()
        assert document["speakers"] == [
            {"id": document["speakers"][0]["id"], "name": "SPK_0", "color": "#28B8A7"}
        ]
        assert [item["status"] for item in document["segments"]] == ["draft", "draft"]
        assert document["segments"][0]["speaker_id"] == document["speakers"][0]["id"]
        assert document["segments"][0]["text"] == "第一句。"
        assert document["segments"][1]["speaker_id"] is None

        task = (await client.get(f"/v1/model-test/transcription-tasks/{task_id}")).json()
        deleted = await client.delete(
            f"/v1/model-test/transcription-tasks/{task_id}",
            params={"expected_revision": task["revision"]},
        )
        assert deleted.status_code == 200
        assert (
            await client.get(f"/v1/audio-annotation/projects/{project['id']}")
        ).status_code == 200
        assert (await client.get(f"/v1/files/{project['asset_id']}/content")).status_code == 200

        assert (
            await client.delete(
                f"/v1/audio-annotation/projects/{project['id']}",
                params={"expected_revision": project["revision"]},
            )
        ).status_code == 200
        library_asset = next(
            item
            for item in (await client.get("/v1/files", params={"media_kind": "audio"})).json()[
                "items"
            ]
            if item["id"] == project["asset_id"]
        )
        assert (
            await client.delete(
                f"/v1/files/{library_asset['id']}",
                params={"expected_revision": library_asset["revision"]},
            )
        ).status_code == 200


@pytest.mark.asyncio
async def test_transcription_import_reuses_library_audio_and_handles_plain_text_json() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        asset = await upload_audio(client, "library-source.wav")
        task_id = await seed_transcription_task(
            filename="library-source.wav",
            source_asset_id=asset["id"],
            text="只有完整转写。",
            write_private_audio=False,
        )
        imported_task = await client.post(
            "/v1/audio-annotation/transcription-imports",
            json={"source_kind": "task", "task_id": task_id},
        )
        assert imported_task.status_code == 200, imported_task.text
        task_project = imported_task.json()
        assert task_project["asset_id"] == asset["id"]
        task_document = (
            await client.get(f"/v1/audio-annotation/projects/{task_project['id']}/document")
        ).json()
        assert task_document["segments"] == [
            {
                "id": task_document["segments"][0]["id"],
                "start_ms": 0,
                "end_ms": task_project["duration_ms"],
                "speaker_id": None,
                "speaker_ids": [],
                "emotion": None,
                "speaker_emotions": [],
                "text": "只有完整转写。",
                "language": None,
                "localized_texts": [],
                "status": "draft",
            }
        ]

        imported_json = await client.post(
            "/v1/audio-annotation/transcription-imports",
            json={
                "source_kind": "json",
                "title": "JSON 识别导入",
                "asset_id": asset["id"],
                "text": "JSON 全文",
                "segments": [],
            },
        )
        assert imported_json.status_code == 200, imported_json.text
        json_project = imported_json.json()
        json_document = (
            await client.get(f"/v1/audio-annotation/projects/{json_project['id']}/document")
        ).json()
        assert json_document["segments"][0]["text"] == "JSON 全文"
        assert json_document["segments"][0]["end_ms"] == json_project["duration_ms"]

        for project in (task_project, json_project):
            assert (
                await client.delete(
                    f"/v1/audio-annotation/projects/{project['id']}",
                    params={"expected_revision": project["revision"]},
                )
            ).status_code == 200
        task = (await client.get(f"/v1/model-test/transcription-tasks/{task_id}")).json()
        assert (
            await client.delete(
                f"/v1/model-test/transcription-tasks/{task_id}",
                params={"expected_revision": task["revision"]},
            )
        ).status_code == 200
        assert (
            await client.delete(
                f"/v1/files/{asset['id']}",
                params={"expected_revision": asset["revision"]},
            )
        ).status_code == 200


@pytest.mark.asyncio
async def test_transcription_import_keeps_overlaps_and_rejects_invalid_results() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        asset = await upload_audio(client, "invalid-transcription.wav")
        overlap = await client.post(
            "/v1/audio-annotation/transcription-imports",
            json={
                "source_kind": "json",
                "title": "重叠片段",
                "asset_id": asset["id"],
                "text": "",
                "segments": [
                    {"speaker": "A", "start_ms": 0, "end_ms": 600, "text": "一"},
                    {"speaker": "短片段", "start_ms": 200, "end_ms": 299, "text": "忽略"},
                    {"speaker": "B", "start_ms": 500, "end_ms": 900, "text": "二"},
                ],
            },
        )
        assert overlap.status_code == 200, overlap.text
        overlap_project = overlap.json()
        overlap_document = (
            await client.get(f"/v1/audio-annotation/projects/{overlap_project['id']}/document")
        ).json()
        assert [(item["start_ms"], item["end_ms"]) for item in overlap_document["segments"]] == [
            (0, 600),
            (500, 900),
        ]
        assert [
            next(
                speaker["name"]
                for speaker in overlap_document["speakers"]
                if speaker["id"] == item["speaker_id"]
            )
            for item in overlap_document["segments"]
        ] == ["A", "B"]

        invalid_cases = [
            (
                "空识别结果",
                {"text": "", "segments": []},
                "transcription_empty",
            ),
            (
                "反向时间戳",
                {
                    "text": "",
                    "segments": [{"speaker": "A", "start_ms": 200, "end_ms": 100, "text": "错误"}],
                },
                "segment_too_short",
            ),
            (
                "越界片段",
                {
                    "text": "",
                    "segments": [
                        {
                            "speaker": "A",
                            "start_ms": 900,
                            "end_ms": 1100,
                            "text": "越界",
                        }
                    ],
                },
                "segment_out_of_range",
            ),
        ]
        for title, result, code in invalid_cases:
            response = await client.post(
                "/v1/audio-annotation/transcription-imports",
                json={
                    "source_kind": "json",
                    "title": title,
                    "asset_id": asset["id"],
                    **result,
                },
            )
            assert response.status_code == 422
            assert response.json()["code"] == code

        pending_id = await seed_transcription_task(status="queued")
        pending = await client.post(
            "/v1/audio-annotation/transcription-imports",
            json={"source_kind": "task", "task_id": pending_id},
        )
        assert pending.status_code == 409
        assert pending.json()["code"] == "transcription_not_completed"

        other_owner_user_id = str(uuid4())
        async with SessionLocal() as session:
            session.add(account_record(id=other_owner_user_id, name="其他标注空间"))
            await session.commit()
        other_task_id = await seed_transcription_task(owner_user_id=other_owner_user_id)
        isolated = await client.post(
            "/v1/audio-annotation/transcription-imports",
            json={"source_kind": "task", "task_id": other_task_id},
        )
        assert isolated.status_code == 404

        pending_task = (await client.get(f"/v1/model-test/transcription-tasks/{pending_id}")).json()
        async with SessionLocal() as session:
            bind_owner(session, "test-user")
            row = await session.get(ModelTestTranscriptionTask, pending_id)
            assert row is not None
            row.status = "failed"
            await session.commit()
        assert (
            await client.delete(
                f"/v1/model-test/transcription-tasks/{pending_id}",
                params={"expected_revision": pending_task["revision"]},
            )
        ).status_code == 200
        assert (
            await client.delete(
                f"/v1/audio-annotation/projects/{overlap_project['id']}",
                params={"expected_revision": overlap_project["revision"]},
            )
        ).status_code == 200
        assert (
            await client.delete(
                f"/v1/files/{asset['id']}",
                params={"expected_revision": asset["revision"]},
            )
        ).status_code == 200
        async with SessionLocal() as session:
            bind_owner(session, other_owner_user_id)
            task = await session.get(ModelTestTranscriptionTask, other_task_id)
            assert task is not None
            private_path = (
                get_settings().account_model_test_path(other_owner_user_id, "references")
                / task.input_storage_key
            )
            await session.delete(task)
            await session.commit()
            private_path.unlink(missing_ok=True)
        async with SessionLocal() as session:
            workspace = await session.get(User, other_owner_user_id)
            assert workspace is not None
            await session.delete(workspace)
            await session.commit()


@pytest.mark.asyncio
async def test_transcription_import_reports_missing_source_and_cleans_failed_copy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    missing_task_id = await seed_transcription_task(write_private_audio=False)
    cleanup_task_id = await seed_transcription_task(filename="cleanup-copy.wav")
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        missing = await client.post(
            "/v1/audio-annotation/transcription-imports",
            json={"source_kind": "task", "task_id": missing_task_id},
        )
        assert missing.status_code == 404
        assert missing.json()["code"] == "source_not_found"

        library_root = get_settings().account_path("test-user") / "library/assets"
        files_before = set(library_root.iterdir()) if library_root.exists() else set()
        original_duration = AudioAnnotationProjects._duration

        async def fail_after_copy(self: AudioAnnotationProjects, asset) -> int:
            if asset.original_filename == "cleanup-copy.wav":
                raise AudioAnnotationError("模拟项目创建失败", code="simulated_failure")
            return await original_duration(self, asset)

        monkeypatch.setattr(AudioAnnotationProjects, "_duration", fail_after_copy)
        failed = await client.post(
            "/v1/audio-annotation/transcription-imports",
            json={"source_kind": "task", "task_id": cleanup_task_id},
        )
        assert failed.status_code == 422
        assert failed.json()["code"] == "simulated_failure"
        files_after = set(library_root.iterdir()) if library_root.exists() else set()
        assert files_after == files_before
        listed = await client.get("/v1/files", params={"query": "cleanup-copy"})
        assert listed.json()["items"] == []

        for task_id in (missing_task_id, cleanup_task_id):
            task = (await client.get(f"/v1/model-test/transcription-tasks/{task_id}")).json()
            assert (
                await client.delete(
                    f"/v1/model-test/transcription-tasks/{task_id}",
                    params={"expected_revision": task["revision"]},
                )
            ).status_code == 200
