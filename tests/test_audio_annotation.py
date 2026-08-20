from __future__ import annotations

import io
import wave
from uuid import uuid4

import httpx
import pytest

from app.audio_annotation.projects import AudioAnnotationError, AudioAnnotationProjects
from app.core.config import get_settings
from app.core.db import SessionLocal
from app.core.tenant_context import bind_workspace
from app.main import app
from app.models import ModelTestTranscriptionTask, Workspace


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


async def seed_transcription_task(
    *,
    filename: str = "recognized.wav",
    status: str = "completed",
    source_asset_id: str | None = None,
    text: str = "识别全文",
    segments: list[dict] | None = None,
    workspace_id: str = "default",
    write_private_audio: bool = True,
) -> str:
    storage_key = uuid4().hex
    content = wav_bytes()
    path = get_settings().workspace_model_test_path(workspace_id, "references") / storage_key
    if write_private_audio:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    async with SessionLocal() as session:
        bind_workspace(session, workspace_id)
        row = ModelTestTranscriptionTask(
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
        assert saved.json()["segments"][0]["language"] == "ja"
        assert saved.json()["segments"][0]["localized_texts"] == [
            {"language": "zh", "text": "没问题。"},
            {"language": "en", "text": "Don't worry."},
        ]

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
        assert conflict.json()["current_revision"] == 1

        overlapping = await client.put(
            f"/v1/audio-annotation/projects/{project['id']}/document",
            json={
                "expected_revision": 1,
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

        other_workspace_id = str(uuid4())
        async with SessionLocal() as session:
            session.add(Workspace(id=other_workspace_id, name="其他标注空间"))
            await session.commit()
        other_task_id = await seed_transcription_task(workspace_id=other_workspace_id)
        isolated = await client.post(
            "/v1/audio-annotation/transcription-imports",
            json={"source_kind": "task", "task_id": other_task_id},
        )
        assert isolated.status_code == 404

        pending_task = (await client.get(f"/v1/model-test/transcription-tasks/{pending_id}")).json()
        async with SessionLocal() as session:
            bind_workspace(session, "default")
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
            bind_workspace(session, other_workspace_id)
            task = await session.get(ModelTestTranscriptionTask, other_task_id)
            assert task is not None
            private_path = (
                get_settings().workspace_model_test_path(other_workspace_id, "references")
                / task.input_storage_key
            )
            await session.delete(task)
            await session.commit()
            private_path.unlink(missing_ok=True)
        async with SessionLocal() as session:
            workspace = await session.get(Workspace, other_workspace_id)
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

        library_root = get_settings().library_asset_path
        files_before = set(library_root.iterdir()) if library_root.exists() else set()
        original_duration = AudioAnnotationProjects._duration

        def fail_after_copy(self: AudioAnnotationProjects, asset) -> int:
            if asset.original_filename == "cleanup-copy.wav":
                raise AudioAnnotationError("模拟项目创建失败", code="simulated_failure")
            return original_duration(self, asset)

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
