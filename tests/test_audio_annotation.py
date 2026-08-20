from __future__ import annotations

import io
import wave

import httpx
import pytest

from app.main import app


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
                        "text": "欢迎开始访谈。",
                        "status": "reviewed",
                    }
                ],
            },
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["revision"] == 1

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
                "speakers": [],
                "segments": [
                    {
                        "id": "one",
                        "start_ms": 0,
                        "end_ms": 500,
                        "speaker_id": None,
                        "text": "",
                        "status": "draft",
                    },
                    {
                        "id": "two",
                        "start_ms": 400,
                        "end_ms": 700,
                        "speaker_id": None,
                        "text": "",
                        "status": "draft",
                    },
                ],
            },
        )
        assert overlapping.status_code == 422
        assert overlapping.json()["code"] == "segments_overlap"

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
