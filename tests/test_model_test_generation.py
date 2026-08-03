from __future__ import annotations

from uuid import uuid4

import httpx
import pytest

from app.llm.playground.generation_runner import ModelTestGenerationRunner
from app.llm.providers._senseaudio import ProviderTaskStatus
from app.main import app


@pytest.mark.asyncio
async def test_image_generation_test_is_created_and_managed_through_v1_api(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_create(**_kwargs) -> str:
        return "provider-task-1"

    async def fake_status(**_kwargs) -> ProviderTaskStatus:
        return ProviderTaskStatus(status="failed", error_message="测试上游失败")

    monkeypatch.setattr("app.llm.playground.generation_runner.create_image_task", fake_create)
    monkeypatch.setattr("app.llm.playground.generation_runner.get_image_task", fake_status)
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

        runner = ModelTestGenerationRunner()
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
