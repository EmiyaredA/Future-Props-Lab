from uuid import uuid4

import httpx
import pytest
from sqlalchemy import func, select

from app.main import app
from app.runtime.db import SessionLocal
from studio.apps.visual_workshop.storage.models import VisualGenerationTask


async def fixture_task(
    client, *, error="任务处理失败（ConnectError）", remote="existing-remote", url=None
):
    response = await client.post(
        "/v1/visual-workshop/projects", json={"title": "结果恢复测试", "kind": "canvas"}
    )
    assert response.status_code == 200
    task = VisualGenerationTask(
        owner_user_id="test-user",
        id=str(uuid4()),
        project_id=response.json()["id"],
        provider_id=None,
        model_id=None,
        provider_kind="autodl_video",
        generation_kind="video",
        provider_name="Mock only",
        model_slug="minimax_h3_zm_nono",
        request_payload={"prompt": "test"},
        provider_task_id=remote,
        status="failed",
        error_message=error,
        result_url=url,
    )
    async with SessionLocal() as session:
        session.add(task)
        await session.commit()
    return task.id


@pytest.mark.asyncio
async def test_legacy_poll_failure_recovers_same_task_and_repeated_click_is_idempotent():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        task_id = await fixture_task(client)
        detail = await client.get(f"/v1/visual-workshop/generation-tasks/{task_id}")
        assert detail.json()["can_retry_materialization"] is True
        path = f"/v1/visual-workshop/generation-tasks/{task_id}/retry-materialization"
        first = await client.post(path)
        second = await client.post(path)
        assert first.status_code == second.status_code == 200
        for result in [first.json(), second.json()]:
            assert result["id"] == task_id
            assert result["provider_task_id"] == "existing-remote"
            assert result["status"] == "pending"
            assert result["error_message"] is None
        assert first.json()["revision"] == second.json()["revision"]
        async with SessionLocal() as session:
            count = await session.scalar(
                select(func.count(VisualGenerationTask.id)).where(
                    VisualGenerationTask.id == task_id
                )
            )
            assert count == 1


@pytest.mark.asyncio
async def test_result_url_still_recovers_materialization():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        task_id = await fixture_task(client, error="下载失败", url="https://example.com/result.mp4")
        response = await client.post(
            f"/v1/visual-workshop/generation-tasks/{task_id}/retry-materialization"
        )
        assert response.status_code == 200
        assert response.json()["status"] == "processing"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error,remote", [("供应商生成失败", "existing-remote"), ("任务处理失败（ConnectError）", None)]
)
async def test_real_failure_or_unknown_submission_cannot_resume(error, remote):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        task_id = await fixture_task(client, error=error, remote=remote)
        detail = await client.get(f"/v1/visual-workshop/generation-tasks/{task_id}")
        assert detail.json()["can_retry_materialization"] is False
        response = await client.post(
            f"/v1/visual-workshop/generation-tasks/{task_id}/retry-materialization"
        )
        assert response.status_code == 422


@pytest.mark.asyncio
async def test_concurrent_recovery_requests_preserve_one_original_task():
    import asyncio

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        task_id = await fixture_task(client)
        path = f"/v1/visual-workshop/generation-tasks/{task_id}/retry-materialization"
        responses = await asyncio.gather(client.post(path), client.post(path))
        assert [response.status_code for response in responses] == [200, 200]
        assert {response.json()["id"] for response in responses} == {task_id}
        assert {response.json()["provider_task_id"] for response in responses} == {
            "existing-remote"
        }
        assert {response.json()["revision"] for response in responses} == {1}
