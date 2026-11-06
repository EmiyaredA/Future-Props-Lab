from __future__ import annotations

from uuid import uuid4

import httpx
import pytest

from studio.apps.model_service.playground.generation_runner import ModelTestGenerationRunner
from studio.apps.model_service.providers._senseaudio import ProviderTaskStatus
from studio.config.settings import get_settings as isolated_settings
from studio.runtime.secrets import SecretCipher
from website_test_support import SessionLocal, app


@pytest.mark.asyncio
async def test_image_generation_test_is_created_and_managed_through_v1_api(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_create(**_kwargs) -> str:
        return "provider-task-1"

    async def fake_status(**_kwargs) -> ProviderTaskStatus:
        return ProviderTaskStatus(status="failed", error_message="测试上游失败")

    monkeypatch.setattr(
        "studio.apps.model_service.playground.generation_runner.submit_generation_task", fake_create
    )
    monkeypatch.setattr(
        "studio.apps.model_service.playground.generation_runner.poll_generation_task", fake_status
    )
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        catalog = (await client.get("/v1/model-providers")).json()
        provider_response = await client.post(
            "/v1/model-providers",
            json={
                "expected_catalog_revision": catalog["revision"],
                "name": f"image-test-{uuid4()}",
                "kind": "senseaudio_image",
                "base_url": "https://api.senseaudio.cn/v1",
                "api_key": "test-secret",
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
                "slug": "senseaudio-image-2.0-260319",
                "label": "API 图片测试模型",
                "description": "",
                "capabilities": ["image_generation"],
                "categories": ["image_generation"],
                "enabled": True,
            },
        )
        assert model_response.status_code == 200, model_response.text
        model = model_response.json()["model"]

        options = (await client.get("/v1/model-test/generation-options")).json()
        assert any(item["id"] == model["id"] for item in options["items"])
        created = await client.post(
            "/v1/model-test/generation-tasks",
            json={
                "kind": "image",
                "model_id": model["id"],
                "prompt": "未来城市",
                "size": "1024x1024",
                "seed": 7,
            },
        )
        assert created.status_code == 200, created.text
        task = created.json()
        assert task["status"] == "queued"
        assert task["request_payload"]["prompt"] == "未来城市"

        blocked = await client.delete(
            f"/v1/model-test/generation-tasks/{task['id']}",
            params={"expected_revision": task["revision"]},
        )
        assert blocked.status_code == 409

        runner = ModelTestGenerationRunner(
            SessionLocal,
            decrypt=SecretCipher(isolated_settings().fpl_secrets_key).decrypt,
            settings=isolated_settings(),
        )
        await runner.process_once()
        await runner.process_once()

        failed = (await client.get(f"/v1/model-test/generation-tasks/{task['id']}")).json()
        assert failed["status"] == "failed"
        assert failed["error_message"] == "测试上游失败"
        assert failed["log_id"]
        log = (await client.get(f"/v1/llm-call-logs/{failed['log_id']}")).json()
        assert log["call_source"] == "model_playground"
        assert "test-secret" not in str(log)

        deleted = await client.delete(
            f"/v1/model-test/generation-tasks/{task['id']}",
            params={"expected_revision": failed["revision"]},
        )
        assert deleted.status_code == 200
        current_revision = (await client.get("/v1/model-providers")).json()["revision"]
        assert (
            await client.delete(
                f"/v1/model-providers/{provider['id']}",
                params={"expected_catalog_revision": current_revision},
            )
        ).status_code == 200
        await client.delete(f"/v1/llm-call-logs/{failed['log_id']}")


@pytest.mark.asyncio
async def test_video_generation_accepts_uploaded_reference_audio_and_video(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    submitted: dict = {}

    async def fake_create(**kwargs) -> str:
        submitted.update(kwargs)
        return "provider-video-task-1"

    async def fake_status(**_kwargs) -> ProviderTaskStatus:
        return ProviderTaskStatus(status="failed", error_message="停止测试任务")

    async def fake_upload(*, mime_type: str, **_kwargs) -> str:
        suffix = "audio.mp3" if mime_type.startswith("audio/") else "video.mp4"
        return f"https://temp.sh/{suffix}"

    monkeypatch.setattr(
        "studio.apps.model_service.playground.generation_runner.submit_generation_task", fake_create
    )
    monkeypatch.setattr(
        "studio.apps.model_service.playground.generation_runner.poll_generation_task", fake_status
    )
    monkeypatch.setattr(
        "studio.apps.model_service.playground.generation_runner.upload_temporary_reference",
        fake_upload,
    )
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        catalog = (await client.get("/v1/model-providers")).json()
        provider_response = await client.post(
            "/v1/model-providers",
            json={
                "expected_catalog_revision": catalog["revision"],
                "name": f"video-reference-test-{uuid4()}",
                "kind": "senseaudio_video",
                "base_url": "https://api.senseaudio.cn/v1",
                "api_key": "test-secret",
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
                "slug": "doubao-seedance-2-0-260128",
                "label": "API 视频参考测试模型",
                "description": "",
                "capabilities": ["video_generation"],
                "categories": ["video_generation"],
                "enabled": True,
            },
        )
        assert model_response.status_code == 200, model_response.text
        model = model_response.json()["model"]

        video_upload = await client.post(
            "/v1/model-test/generation-assets",
            files={"files": ("reference.mp4", b"\x00\x00\x00\x18ftypisomtest", "video/mp4")},
        )
        audio_upload = await client.post(
            "/v1/model-test/generation-assets",
            files={"files": ("reference.mp3", b"ID3test-audio", "audio/mpeg")},
        )
        assert video_upload.status_code == 200, video_upload.text
        assert audio_upload.status_code == 200, audio_upload.text
        video_asset = video_upload.json()["items"][0]
        audio_asset = audio_upload.json()["items"][0]

        audio_only = await client.post(
            "/v1/model-test/generation-tasks",
            json={
                "kind": "video",
                "model_id": model["id"],
                "prompt": "跟随参考音频",
                "audio_asset_ids": [audio_asset["id"]],
            },
        )
        assert audio_only.status_code == 422

        created = await client.post(
            "/v1/model-test/generation-tasks",
            json={
                "kind": "video",
                "model_id": model["id"],
                "prompt": "保留视频运镜并跟随音乐节奏",
                "duration": 8,
                "resolution": "720p",
                "ratio": "16:9",
                "watermark": False,
                "generate_audio": True,
                "audio_asset_ids": [audio_asset["id"]],
                "video_asset_ids": [video_asset["id"]],
            },
        )
        assert created.status_code == 200, created.text
        task = created.json()
        assert task["request_payload"]["audio_asset_ids"] == [audio_asset["id"]]
        assert task["request_payload"]["video_asset_ids"] == [video_asset["id"]]
        assert "data:" not in created.text

        runner = ModelTestGenerationRunner(
            SessionLocal,
            decrypt=SecretCipher(isolated_settings().fpl_secrets_key).decrypt,
            settings=isolated_settings(),
        )
        await runner.process_once()
        content = submitted["video_content"]
        assert content[0] == {"type": "text", "text": "保留视频运镜并跟随音乐节奏"}
        assert content[1]["type"] == "audio"
        assert content[1]["audio_url"] == "https://temp.sh/audio.mp3"
        assert content[2]["type"] == "video"
        assert content[2]["video_url"] == "https://temp.sh/video.mp4"

        await runner.process_once()
        failed = (await client.get(f"/v1/model-test/generation-tasks/{task['id']}")).json()
        assert failed["status"] == "failed"
        assert "temp.sh" not in str(failed)
        log = (await client.get(f"/v1/llm-call-logs/{failed['log_id']}")).json()
        assert "temp.sh" not in str(log)
        assert (
            await client.delete(
                f"/v1/model-test/generation-tasks/{task['id']}",
                params={"expected_revision": failed["revision"]},
            )
        ).status_code == 200
        current_revision = (await client.get("/v1/model-providers")).json()["revision"]
        assert (
            await client.delete(
                f"/v1/model-providers/{provider['id']}",
                params={"expected_catalog_revision": current_revision},
            )
        ).status_code == 200
        await client.delete(f"/v1/llm-call-logs/{failed['log_id']}")
