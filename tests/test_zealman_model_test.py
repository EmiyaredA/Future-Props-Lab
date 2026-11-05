from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import httpx
import pytest

from studio.apps.model_service.playground.generation_runner import ModelTestGenerationRunner
from studio.apps.model_service.providers._senseaudio import ProviderTaskStatus
from studio.apps.model_service.providers.zealman_workflows import U06, U17
from studio.apps.model_service.storage.models.model_test import ModelTestGenerationTask
from studio.runtime.time import utc_now
from website_test_support import SessionLocal, app


@pytest.mark.asyncio
@pytest.mark.parametrize("slug", [U06, U17])
async def test_keyless_workflow_api_completion_materialization_logs_and_catalog_cas(
    monkeypatch, slug
):
    submitted = []

    async def submit(**kwargs):
        submitted.append(kwargs)
        return "upstream-task"

    async def poll(**_kwargs):
        return ProviderTaskStatus("completed", 100, "https://example.test/video.mp4")

    monkeypatch.setattr(
        "studio.apps.model_service.playground.generation_runner.create_task", submit
    )
    monkeypatch.setattr("studio.apps.model_service.playground.generation_runner.get_task", poll)
    monkeypatch.setattr("studio.apps.model_service.generation.media.assert_public_https", _allow)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        revision = (await client.get("/v1/model-providers")).json()["revision"]
        body = {
            "expected_catalog_revision": revision,
            "name": f"zealman-{uuid4()}",
            "kind": "zealman_video",
            "base_url": "https://example.test/?_=123",
            "api_key": "",
        }
        response = await client.post("/v1/model-providers", json=body)
        assert response.status_code == 200, response.text
        provider = response.json()["provider"]
        assert provider["base_url"] == "https://example.test"
        assert provider["has_api_key"] is False
        stale = await client.post("/v1/model-providers", json=body)
        assert stale.status_code == 409
        response = await client.post(
            f"/v1/model-providers/{provider['id']}/models",
            json={
                "expected_catalog_revision": response.json()["revision"],
                "slug": slug,
                "capabilities": ["video_generation"],
                "categories": ["video_generation"],
            },
        )
        model = response.json()["model"]
        options = (await client.get("/v1/model-test/generation-options")).json()["items"]
        selected = next(x for x in options if x["id"] == model["id"])
        assert selected["workflow_capabilities"]["reference_limits"]["video"] == (
            1 if slug == U17 else 0
        )
        for values in (
            {"resolution": "720p"},
            {"workflow_parameters": {"width": 641}},
            {"workflow_parameters": {"unknown": 1}},
        ):
            invalid = await client.post(
                "/v1/model-test/generation-tasks",
                json={"kind": "video", "model_id": model["id"], "prompt": "test", **values},
            )
            assert invalid.status_code == 422, invalid.text
        response = await client.post(
            "/v1/model-test/generation-tasks",
            json={"kind": "video", "model_id": model["id"], "prompt": "test"},
        )
        assert response.status_code == 200, response.text
        task = response.json()
        if slug == U06:
            assert isinstance(task["request_payload"]["workflow_parameters"]["seed"], int)
        downloads = 0

        def download(_request):
            nonlocal downloads
            downloads += 1
            if slug == U17 and downloads == 1:
                return httpx.Response(503)
            return httpx.Response(
                200,
                content=b"\x00\x00\x00\x18ftypisom" + b"test",
                headers={"content-type": "video/mp4"},
            )

        runner = ModelTestGenerationRunner(
            SessionLocal, download_transport=httpx.MockTransport(download)
        )
        await runner.process_once()
        assert submitted[-1]["api_key"] == ""
        assert (
            submitted[-1]["payload"]["workflow_parameters"]
            == task["request_payload"]["workflow_parameters"]
        )
        await runner.process_once()
        completed = (await client.get(f"/v1/model-test/generation-tasks/{task['id']}")).json()
        if slug == U17:
            assert completed["status"] == "failed"
            previous_log = completed["log_id"]
            retried = await client.post(
                f"/v1/model-test/generation-tasks/{task['id']}/retry-materialization"
            )
            assert retried.status_code == 200
            await runner.process_once()
            completed = (await client.get(f"/v1/model-test/generation-tasks/{task['id']}")).json()
            assert completed["log_id"] != previous_log
            assert (await client.get(f"/v1/llm-call-logs/{previous_log}")).json()[
                "status"
            ] == "error"
        assert completed["status"] == "completed", completed
        assert completed["result_available"]
        log = (await client.get(f"/v1/llm-call-logs/{completed['log_id']}")).json()
        assert log["status"] == "success"
        assert log["provider_kind"] == "zealman_video"
        result = await client.get(f"/v1/model-test/generation-tasks/{task['id']}/content")
        assert result.status_code == 200
        # The driver recovers old submissions as failures without resubmitting them.
        async with SessionLocal() as session:
            row = await session.get(ModelTestGenerationTask, task["id"])
            row.status = "submitting"
            await session.commit()
        await runner.recover()
        await runner.process_once()
        assert len([x for x in submitted if x["model"] == slug]) == 1


async def _allow(_url):
    return None


@pytest.mark.asyncio
async def test_expired_workflow_task_fails_before_polling(monkeypatch):
    async with SessionLocal() as session:
        row = ModelTestGenerationTask(
            owner_user_id="test-user",
            provider_kind="zealman_video",
            generation_kind="video",
            provider_name="expired",
            model_slug=U06,
            status="pending",
            provider_task_id="old",
            created_at=utc_now() - timedelta(hours=2),
        )
        session.add(row)
        await session.commit()
        identity = row.id

    async def poll(**_kwargs):
        pytest.fail("expired tasks must not poll")

    monkeypatch.setattr("studio.apps.model_service.playground.generation_runner.get_task", poll)
    # Directly exercise the owner hook with a restored context; no upstream resubmission.
    runner = ModelTestGenerationRunner(SessionLocal)
    async with SessionLocal() as session:
        row = await session.get(ModelTestGenerationTask, identity)
        context = runner.task_store._context(row, owner_user_id="test-user")
    with pytest.raises(ValueError, match="60 分钟"):
        await runner._poll_context(context)
