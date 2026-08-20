from __future__ import annotations

import io
import wave
from copy import deepcopy

import httpx
import pytest
from PIL import Image
from sqlalchemy import delete

from app.core.credentials import encrypt_secret
from app.core.db import SessionLocal
from app.galgame_workshop.asr import GalgameAsrRunner
from app.galgame_workshop.assets import normalize_import_filename
from app.main import app
from app.models import (
    GalgameAssetMetadata,
    GalgameAssetSettings,
    GalgameAssetTranscriptionTask,
    ModelEntry,
    ModelProvider,
)
from app.schemas.galgame_workshop import GalgameStoryProject


def image_bytes(width: int = 16, height: int = 32) -> bytes:
    target = io.BytesIO()
    Image.new("RGBA", (width, height), (255, 20, 80, 255)).save(target, format="PNG")
    return target.getvalue()


def wav_bytes() -> bytes:
    target = io.BytesIO()
    with wave.open(target, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(8000)
        audio.writeframes(b"\x00\x00" * 800)
    return target.getvalue()


@pytest.mark.asyncio
async def test_library_listing_excludes_galgame_assets_and_project_accepts_documents() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post(
                "/v1/galgame-workshop/projects",
                json={"title": "项目文件归属测试"},
            )
        ).json()
        private_image = await client.post(
            f"/v1/galgame-workshop/projects/{project['id']}/assets",
            files={
                "upload": (
                    "scope-private.png",
                    image_bytes(),
                    "image/png",
                )
            },
        )
        assert private_image.status_code == 200, private_image.text
        project_document = await client.post(
            f"/v1/galgame-workshop/projects/{project['id']}/assets",
            files={
                "upload": (
                    "scope-transcript.json",
                    b'{"kind":"audio-transcript","entries":[]}',
                    "application/json",
                )
            },
        )
        assert project_document.status_code == 200, project_document.text
        document = project_document.json()
        assert document["media_kind"] == "document"

        organized = await client.patch(
            f"/v1/galgame-workshop/projects/{project['id']}/assets/{document['id']}",
            json={
                "expectedRevision": document["revision"],
                "virtualPath": "references/transcripts/scope-transcript.json",
                "packagingPolicy": "exclude",
            },
        )
        assert organized.status_code == 200, organized.text
        assert organized.json()["packagingPolicy"] == "exclude"

        library_image = await client.post(
            "/v1/files",
            files={
                "upload": (
                    "scope-shared.png",
                    image_bytes(),
                    "image/png",
                )
            },
        )
        assert library_image.status_code == 200, library_image.text
        library_asset = library_image.json()

        listed = await client.get("/v1/files", params={"query": "scope-"})
        assert listed.status_code == 200, listed.text
        assert [item["id"] for item in listed.json()["items"]] == [library_asset["id"]]

        content = await client.get(f"/v1/files/{document['id']}/content")
        assert content.status_code == 200
        assert content.json()["kind"] == "audio-transcript"

        removed_project = await client.delete(
            f"/v1/galgame-workshop/projects/{project['id']}",
            params={"expected_revision": project["revision"]},
        )
        assert removed_project.status_code == 200, removed_project.text
        removed_library = await client.delete(
            f"/v1/files/{library_asset['id']}",
            params={"expected_revision": library_asset["revision"]},
        )
        assert removed_library.status_code == 200, removed_library.text


def story_with_dialogue() -> dict:
    return {
        "schemaVersion": "1.2",
        "entryChapterId": "chapter-1",
        "characters": [{"id": "hero", "name": "玲", "expressions": []}],
        "sceneGroups": [],
        "scenes": [],
        "variables": [],
        "assets": [],
        "chapters": [
            {
                "id": "chapter-1",
                "title": "第一章",
                "order": 1,
                "entryFragmentId": "main",
                "fragments": [
                    {
                        "id": "main",
                        "title": "main",
                        "blocks": [
                            {
                                "id": "hello-line",
                                "type": "dialogue",
                                "characterId": "hero",
                                "text": "你好，欢迎回来。",
                            }
                        ],
                    }
                ],
            }
        ],
    }


def test_story_11_multibackground_scene_splits_deterministically() -> None:
    source = story_with_dialogue()
    source["schemaVersion"] = "1.1"
    source["assets"] = [
        {
            "id": "room-day-asset",
            "type": "image",
            "role": "sceneBackground",
            "fileId": "day-file",
            "status": "ready",
        },
        {
            "id": "room-night-asset",
            "type": "image",
            "role": "sceneBackground",
            "fileId": "night-file",
            "status": "ready",
        },
    ]
    source["scenes"] = [
        {
            "id": "room",
            "name": "房间",
            "backgrounds": [
                {"id": "day", "label": "白天", "assetId": "room-day-asset"},
                {"id": "night", "label": "夜晚", "assetId": "room-night-asset"},
            ],
            "defaultBackgroundId": "day",
        }
    ]
    source["chapters"][0]["fragments"][0]["blocks"].insert(
        0,
        {
            "id": "room-night-block",
            "type": "scene",
            "sceneId": "room",
            "backgroundId": "night",
        },
    )

    first = GalgameStoryProject.model_validate(deepcopy(source))
    second = GalgameStoryProject.model_validate(deepcopy(source))

    assert first.schema_version == "1.4"
    assert first.scenes[0].id == "room"
    assert first.scenes[0].layers[0].id == "day"
    assert first.scenes[1].id == second.scenes[1].id
    assert first.scenes[1].layers[0].id == "night"
    assert first.chapters[0].fragments[0].blocks[0].scene_id == first.scenes[1].id


def test_import_filename_normalization_removes_paths_and_reserved_symbols() -> None:
    final_name, reasons = normalize_import_filename("C:\\素材\\玲%?#.png. ")

    assert final_name == "玲-.png"
    assert "已移除原始路径" in reasons
    assert "已替换控制字符或保留符号" in reasons


@pytest.mark.asyncio
async def test_asset_import_metadata_packaging_and_cas() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "素材工程"})
        ).json()
        preview = await client.post(
            f"/v1/galgame-workshop/projects/{project['id']}/assets/import-preview",
            json={"filenames": ["folder/night%23.png", "night-.png"], "category": "scene"},
        )
        assert preview.status_code == 200, preview.text
        assert [item["virtualPath"] for item in preview.json()["items"]] == [
            "backgrounds/night-23.png",
            "backgrounds/night-.png",
        ]
        uploaded = await client.post(
            f"/v1/galgame-workshop/projects/{project['id']}/assets",
            data={"category": "scene"},
            files={"upload": ("night.png", image_bytes(32, 18), "image/png")},
        )
        assert uploaded.status_code == 200, uploaded.text
        asset = uploaded.json()
        assert asset["virtualPath"] == "backgrounds/night.png"
        assert asset["width"] == 32
        assert asset["height"] == 18
        assert len(asset["checksumSha256"]) == 64

        patched = await client.patch(
            f"/v1/galgame-workshop/projects/{project['id']}/assets/{asset['id']}",
            json={"expectedRevision": 0, "packagingPolicy": "include"},
        )
        assert patched.status_code == 200, patched.text
        assert patched.json()["revision"] == 1
        conflict = await client.patch(
            f"/v1/galgame-workshop/projects/{project['id']}/assets/{asset['id']}",
            json={"expectedRevision": 0, "displayName": "冲突"},
        )
        assert conflict.status_code == 409
        manifest = await client.get(
            f"/v1/galgame-workshop/projects/{project['id']}/assets/package-manifest"
        )
        assert manifest.status_code == 200
        assert manifest.json()["items"][0]["reason"] == "forced"


@pytest.mark.asyncio
async def test_sequence_frames_are_referenced_packaged_and_delete_protected() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "序列立绘"})
        ).json()
        uploads = []
        for index in range(2):
            response = await client.post(
                f"/v1/galgame-workshop/projects/{project['id']}/assets",
                data={"category": "character"},
                files={
                    "upload": (
                        f"hero-{index}.png",
                        image_bytes(300, 540),
                        "image/png",
                    )
                },
            )
            assert response.status_code == 200, response.text
            uploads.append(response.json())

        document = story_with_dialogue()
        document["assets"] = [
            {
                "id": f"hero-frame-asset-{index}",
                "type": "image",
                "role": "characterPortrait",
                "fileId": upload["id"],
                "status": "ready",
            }
            for index, upload in enumerate(uploads)
        ]
        document["characters"][0]["expressions"] = [
            {
                "id": "hero-idle",
                "label": "待机",
                "assetId": "hero-frame-asset-0",
                "renderMode": "frameSequence",
                "sequence": {
                    "fps": 12,
                    "loop": True,
                    "frames": [
                        {"id": "hero-idle-0", "assetId": "hero-frame-asset-0"},
                        {"id": "hero-idle-1", "assetId": "hero-frame-asset-1"},
                    ],
                },
            }
        ]
        document["characters"][0]["defaultExpressionId"] = "hero-idle"
        saved = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 0, "document": document},
        )
        assert saved.status_code == 200, saved.text

        overview = await client.get(
            f"/v1/galgame-workshop/projects/{project['id']}/assets/overview"
        )
        assert overview.status_code == 200, overview.text
        second = next(item for item in overview.json()["items"] if item["id"] == uploads[1]["id"])
        assert second["reference_count"] == 1
        assert second["references"][0]["kind"] == "characterExpressionFrame"

        manifest = await client.get(
            f"/v1/galgame-workshop/projects/{project['id']}/assets/package-manifest"
        )
        assert manifest.status_code == 200, manifest.text
        assert {item["assetId"] for item in manifest.json()["items"]} == {
            upload["id"] for upload in uploads
        }

        blocked = await client.delete(
            f"/v1/galgame-workshop/projects/{project['id']}/assets/{uploads[1]['id']}",
            params={"expected_revision": uploads[1]["revision"]},
        )
        assert blocked.status_code == 409
        assert blocked.json()["references"][0]["kind"] == "characterExpressionFrame"


@pytest.mark.asyncio
async def test_portrait_height_upgrade_previews_snapshots_and_restores() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "立绘维护"})
        ).json()
        uploaded = (
            await client.post(
                f"/v1/galgame-workshop/projects/{project['id']}/assets",
                data={"category": "character"},
                files={"upload": ("hero.png", image_bytes(300, 540), "image/png")},
            )
        ).json()
        document = story_with_dialogue()
        document["settings"] = {
            "canvas": {"width": 1920, "height": 1080},
            "characterStage": {
                "anchorX": 50,
                "anchorY": 100,
                "defaultHeightPercent": 100,
                "positions": {
                    "left": 15,
                    "centerLeft": 32.5,
                    "center": 50,
                    "centerRight": 67.5,
                    "right": 85,
                },
            },
        }
        document["assets"] = [
            {
                "id": "hero-portrait",
                "type": "image",
                "role": "characterPortrait",
                "fileId": uploaded["id"],
                "status": "ready",
            }
        ]
        document["characters"][0]["expressions"] = [
            {
                "id": "hero-default",
                "label": "默认",
                "assetId": "hero-portrait",
            }
        ]
        document["characters"][0]["defaultExpressionId"] = "hero-default"
        saved = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 0, "document": document},
        )
        assert saved.status_code == 200, saved.text

        preview = await client.get(
            f"/v1/galgame-workshop/projects/{project['id']}/story/portrait-upgrade"
        )
        assert preview.status_code == 200, preview.text
        assert preview.json()["items"][0]["targetHeightPercent"] == 50
        upgraded = await client.post(
            f"/v1/galgame-workshop/projects/{project['id']}/story/portrait-upgrade",
            json={"expectedStoryRevision": 1},
        )
        assert upgraded.status_code == 200, upgraded.text
        expression = upgraded.json()["document"]["characters"][0]["expressions"][0]
        assert expression["heightPercent"] == 50

        snapshots = await client.get(
            f"/v1/galgame-workshop/projects/{project['id']}/story/snapshots"
        )
        assert snapshots.status_code == 200
        restored = await client.post(
            f"/v1/galgame-workshop/projects/{project['id']}/story/snapshots/"
            f"{snapshots.json()[0]['id']}/restore",
            json={"expectedStoryRevision": 2},
        )
        assert restored.status_code == 200, restored.text
        restored_expression = restored.json()["document"]["characters"][0]["expressions"][0]
        assert "heightPercent" not in restored_expression


@pytest.mark.asyncio
async def test_asr_runner_manual_override_force_and_dialogue_match() -> None:
    async with SessionLocal() as session:
        provider = ModelProvider(
            name="测试 ASR",
            kind="openai",
            base_url="https://asr.example/v1",
            api_key_ciphertext=encrypt_secret("test-asr-key"),
            enabled=True,
        )
        session.add(provider)
        await session.flush()
        model = ModelEntry(
            provider_id=provider.id,
            slug="whisper-test",
            label="Whisper Test",
            capabilities=["speech_recognition"],
            categories=["speech_recognition"],
            enabled=True,
        )
        session.add(model)
        await session.commit()

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "语音工程"})
        ).json()
        uploaded = (
            await client.post(
                f"/v1/galgame-workshop/projects/{project['id']}/assets",
                data={"category": "voice"},
                files={"upload": ("hero_001.wav", wav_bytes(), "audio/wav")},
            )
        ).json()
        story_document = story_with_dialogue()
        story_document["chapters"][0]["fragments"][0]["blocks"].append(
            {
                "id": "untouched-line",
                "type": "dialogue",
                "characterId": "hero",
                "text": "这句对白不应被自动匹配。",
            }
        )
        story = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 0, "document": story_document},
        )
        assert story.status_code == 200, story.text
        settings = await client.patch(
            f"/v1/galgame-workshop/projects/{project['id']}/assets/asr/settings",
            json={
                "expectedRevision": 0,
                "modelId": model.id,
                "defaultLanguage": "zh",
                "concurrency": 3,
            },
        )
        assert settings.status_code == 200, settings.text
        created = await client.post(
            f"/v1/galgame-workshop/projects/{project['id']}/assets/asr/transcriptions",
            json={"assetIds": [uploaded["id"]], "language": "zh", "force": False},
        )
        assert created.status_code == 200, created.text

    response_text = "你好，欢迎回来。"

    def fake_asr(request: httpx.Request) -> httpx.Response:
        assert request.url == "https://asr.example/v1/audio/transcriptions"
        assert request.headers["authorization"] == "Bearer test-asr-key"
        return httpx.Response(200, json={"text": response_text})

    runner = GalgameAsrRunner(transport=httpx.MockTransport(fake_asr))
    await runner.process_once()

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        files = (await client.get(f"/v1/galgame-workshop/projects/{project['id']}/assets")).json()
        recognized = next(item for item in files["items"] if item["id"] == uploaded["id"])
        assert recognized["transcript"] == response_text
        assert recognized["transcriptSource"] == "asr"
        manual = await client.patch(
            f"/v1/galgame-workshop/projects/{project['id']}/assets/{uploaded['id']}/transcript",
            json={"expectedRevision": 1, "text": "人工文本", "language": "zh"},
        )
        assert manual.status_code == 200, manual.text
        match = await client.post(
            f"/v1/galgame-workshop/projects/{project['id']}/assets/asr/match-dialogue",
            json={
                "expectedStoryRevision": 1,
                "assetIds": [uploaded["id"]],
                "blockIds": ["hello-line"],
                "minimumSimilarity": 0,
            },
        )
        assert match.status_code == 200, match.text
        assert match.json()["matches"][0]["blockId"] == "hello-line"
        matched_story = (
            await client.get(f"/v1/galgame-workshop/projects/{project['id']}/story")
        ).json()["document"]
        matched_blocks = matched_story["chapters"][0]["fragments"][0]["blocks"]
        assert matched_blocks[0]["voiceAssetId"]
        assert matched_blocks[1]["voiceAssetId"] is None

        response_text = "强制覆盖文本"
        forced = await client.post(
            f"/v1/galgame-workshop/projects/{project['id']}/assets/asr/transcriptions",
            json={"assetIds": [uploaded["id"]], "language": "zh", "force": True},
        )
        assert forced.status_code == 200
    await runner.process_once()
    async with SessionLocal() as session:
        metadata = await session.get(GalgameAssetMetadata, uploaded["id"])
        assert metadata is not None
        assert metadata.transcript == "强制覆盖文本"
        assert metadata.transcript_source == "asr"

        await session.execute(delete(GalgameAssetTranscriptionTask))
        await session.execute(delete(GalgameAssetSettings))
        await session.execute(delete(ModelEntry).where(ModelEntry.id == model.id))
        await session.execute(delete(ModelProvider).where(ModelProvider.id == provider.id))
        await session.commit()
