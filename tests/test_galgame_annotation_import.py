from __future__ import annotations

import hashlib
import io
import math
import wave

import httpx
import pytest

from app.core.db import SessionLocal
from app.core.tenant_context import bind_workspace
from app.galgame_workshop.annotation_import import GalgameAnnotationImportRunner
from app.galgame_workshop.readiness import GalgameReadiness
from app.main import app
from app.models import GalgameAssetMetadata
from app.schemas.galgame_workshop import GalgameStoryReportIssue


def _audio_bytes(seconds: float = 1.0) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(8000)
        frames = bytearray()
        for index in range(round(8000 * seconds)):
            window = index // 160
            amplitude = 2500 + ((window * 7919) % 9500)
            frequency = 260 + (window % 7) * 70
            value = round(math.sin(index / 8000 * math.tau * frequency) * amplitude)
            frames.extend(value.to_bytes(2, "little", signed=True))
        audio.writeframes(frames)
    return output.getvalue()


async def _request(client: httpx.AsyncClient) -> tuple[dict, dict, dict, dict]:
    source_bytes = _audio_bytes()
    source_asset_response = await client.post(
        "/v1/files",
        files={"upload": ("annotation-source.wav", source_bytes, "audio/wav")},
    )
    assert source_asset_response.status_code == 200
    source_asset = source_asset_response.json()
    source_response = await client.post(
        "/v1/audio-annotation/imports",
        json={
            "title": "可导入广播剧",
            "asset_id": source_asset["id"],
            "schema_version": "1.0",
            "speakers": [{"id": "speaker", "name": "说话人", "color": "#28B8A7"}],
            "segments": [
                {
                    "id": "segment-1",
                    "start_ms": 0,
                    "end_ms": 500,
                    "speaker_id": "speaker",
                    "text": "第一句",
                    "language": "zh",
                    "status": "reviewed",
                },
                {
                    "id": "segment-2",
                    "start_ms": 500,
                    "end_ms": 1000,
                    "speaker_id": "speaker",
                    "text": "第二句",
                    "language": "zh",
                    "status": "reviewed",
                },
            ],
        },
    )
    assert source_response.status_code == 200, source_response.text
    source = source_response.json()
    target_response = await client.post(
        "/v1/galgame-workshop/projects", json={"title": "广播剧导入目标"}
    )
    assert target_response.status_code == 200
    target = target_response.json()
    story = (await client.get(f"/v1/galgame-workshop/projects/{target['id']}/story")).json()

    async with SessionLocal() as session:
        bind_workspace(session, "default")
        session.add(
            GalgameAssetMetadata(
                asset_id=source_asset["id"],
                project_id=target["id"],
                category="voice",
                virtual_path="voice/annotation-source.wav",
                packaging_policy="exclude",
                checksum_sha256=hashlib.sha256(source_bytes).hexdigest(),
                duration_ms=1000,
                transcript_status="pending",
            )
        )
        await session.commit()

    document = story["document"]
    document["entryChapterId"] = "chapter-import"
    document["characters"] = [
        {
            "id": "speaker",
            "name": "说话人",
            "themeColor": "#28B8A7",
            "expressions": [],
            "attributes": {},
        }
    ]
    document["assets"] = [
        {
            "id": "master-audio",
            "type": "audio",
            "role": "timelineMaster",
            "label": "完整广播剧",
            "fileId": source_asset["id"],
            "status": "ready",
        },
        {
            "id": "voice-1",
            "type": "audio",
            "role": "voiceLine",
            "label": "第一句",
            "fileId": "segment-1",
            "status": "ready",
        },
        {
            "id": "voice-2",
            "type": "audio",
            "role": "voiceLine",
            "label": "第二句",
            "fileId": "segment-2",
            "status": "ready",
        },
    ]
    document["chapters"] = [
        {
            "id": "chapter-import",
            "title": "导入章节",
            "order": 1,
            "entryFragmentId": "fragment-import",
            "fragments": [
                {
                    "id": "fragment-import",
                    "title": "完整广播剧",
                    "timeline": {
                        "durationMs": 1000,
                        "masterAudio": {"assetId": "master-audio", "volume": 100},
                    },
                    "blocks": [
                        {
                            "id": "line-1",
                            "type": "dialogue",
                            "startMs": 0,
                            "endMs": 500,
                            "characterId": "speaker",
                            "text": "第一句",
                            "voiceAssetId": "voice-1",
                        },
                        {
                            "id": "line-2",
                            "type": "dialogue",
                            "startMs": 500,
                            "endMs": 1000,
                            "characterId": "speaker",
                            "text": "第二句",
                            "voiceAssetId": "voice-2",
                        },
                    ],
                }
            ],
        }
    ]
    body = {
        "requestId": "annotation-import-test",
        "assetPrefix": "annotation-test",
        "sourceProjectId": source["id"],
        "masterAssetId": source_asset["id"],
        "expectedSourceRevision": source["document_revision"],
        "expectedStoryRevision": story["revision"],
        "language": "zh",
        "speakerMap": {"speaker": "speaker"},
        "requirements": {
            "segmentCount": 2,
            "speakerCount": 1,
            "multiSpeakerCount": 0,
            "curtainIntervalCount": 0,
            "stageTransitionCount": 0,
            "timelineDurationMs": 1000,
            "lastDialogueEndMs": 1000,
            "sourceChecksumSha256": hashlib.sha256(source_bytes).hexdigest(),
            "maxDurationDifferenceMs": 50,
            "minContentCorrelation": 0.9,
        },
        "document": document,
    }
    return target, source, source_asset, body


async def _cleanup(
    client: httpx.AsyncClient, target: dict, source: dict, source_asset: dict
) -> None:
    target_current = await client.get(f"/v1/galgame-workshop/projects/{target['id']}")
    assert target_current.status_code == 200
    assert (
        await client.delete(
            f"/v1/galgame-workshop/projects/{target['id']}",
            params={"expected_revision": target_current.json()["revision"]},
        )
    ).status_code == 200
    assert (
        await client.delete(
            f"/v1/audio-annotation/projects/{source['id']}",
            params={"expected_revision": source["revision"]},
        )
    ).status_code == 200
    assert (
        await client.delete(
            f"/v1/files/{source_asset['id']}",
            params={"expected_revision": source_asset["revision"]},
        )
    ).status_code == 200


@pytest.mark.asyncio
async def test_annotation_import_preview_task_idempotency_and_runner() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        target, source, source_asset, body = await _request(client)
        target_id = target["id"]
        preview = await client.post(
            f"/v1/galgame-workshop/projects/{target_id}/annotation-imports/preview",
            json=body,
        )
        assert preview.status_code == 200, preview.text
        assert preview.json()["ready"] is True
        assert [item["segmentId"] for item in preview.json()["segments"]] == [
            "segment-1",
            "segment-2",
        ]

        created = await client.post(
            f"/v1/galgame-workshop/projects/{target_id}/annotation-imports", json=body
        )
        assert created.status_code == 202, created.text
        task = created.json()
        repeated = await client.post(
            f"/v1/galgame-workshop/projects/{target_id}/annotation-imports", json=body
        )
        assert repeated.status_code == 202
        assert repeated.json()["id"] == task["id"]

        await GalgameAnnotationImportRunner().process_once()
        result = await client.get(
            f"/v1/galgame-workshop/projects/{target_id}/annotation-imports/{task['id']}"
        )
        assert result.status_code == 200
        assert result.json()["status"] == "completed", result.text
        assert result.json()["phase"] == "completed"
        assert result.json()["result"]["voiceAssetCount"] == 2
        assert result.json()["result"]["ready"] is True

        story = (await client.get(f"/v1/galgame-workshop/projects/{target_id}/story")).json()
        assert story["revision"] == 1
        voice_assets = [
            asset for asset in story["document"]["assets"] if asset["role"] == "voiceLine"
        ]
        assert len({asset["fileId"] for asset in voice_assets}) == 2
        assert {asset["fileId"] for asset in voice_assets}.isdisjoint({"segment-1", "segment-2"})
        async with SessionLocal() as session:
            bind_workspace(session, "default")
            metadata = await session.get(GalgameAssetMetadata, source_asset["id"])
            assert metadata is not None
            assert metadata.packaging_policy == "include"
        await _cleanup(client, target, source, source_asset)


@pytest.mark.asyncio
async def test_annotation_import_rolls_back_when_post_save_acceptance_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original_report = GalgameReadiness.report

    async def rejected_report(self: GalgameReadiness, project_id: str):
        report = await original_report(self, project_id)
        return report.model_copy(
            update={
                "ready": False,
                "errors": [
                    GalgameStoryReportIssue(
                        code="forced_acceptance_failure",
                        message="测试强制验收失败",
                        path="/",
                    )
                ],
            }
        )

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        target, source, source_asset, body = await _request(client)
        target_id = target["id"]
        before = (await client.get(f"/v1/galgame-workshop/projects/{target_id}/story")).json()
        created = await client.post(
            f"/v1/galgame-workshop/projects/{target_id}/annotation-imports", json=body
        )
        assert created.status_code == 202, created.text
        monkeypatch.setattr(GalgameReadiness, "report", rejected_report)

        await GalgameAnnotationImportRunner().process_once()

        task = (
            await client.get(
                f"/v1/galgame-workshop/projects/{target_id}/annotation-imports/"
                f"{created.json()['id']}"
            )
        ).json()
        assert task["status"] == "rolled_back"
        assert task["phase"] == "rolled_back"
        after = (await client.get(f"/v1/galgame-workshop/projects/{target_id}/story")).json()
        assert after["document"] == before["document"]
        assert after["revision"] == 2
        assert task["result"]["voiceAssetCount"] == 2
        assert len(task["result"]["segments"]) == 2
        async with SessionLocal() as session:
            bind_workspace(session, "default")
            metadata = await session.get(GalgameAssetMetadata, source_asset["id"])
            assert metadata is not None
            assert metadata.packaging_policy == "exclude"
        await _cleanup(client, target, source, source_asset)


@pytest.mark.asyncio
async def test_annotation_import_preview_reports_revision_and_mapping_errors() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        target, source, source_asset, body = await _request(client)
        target_id = target["id"]
        body["expectedStoryRevision"] = 99
        body["speakerMap"] = {"unknown": "speaker"}
        preview = await client.post(
            f"/v1/galgame-workshop/projects/{target_id}/annotation-imports/preview",
            json=body,
        )
        assert preview.status_code == 200
        codes = {issue["code"] for issue in preview.json()["issues"]}
        assert {"story_revision_conflict", "speaker_map_mismatch"}.issubset(codes)
        assert preview.json()["ready"] is False
        await _cleanup(client, target, source, source_asset)
