from __future__ import annotations

import httpx
import pytest

from app.galgame_workshop.video_export import EXPORT_PACKAGING_POLICY
from app.main import app
from test_galgame_workshop import playable_story


@pytest.mark.asyncio
async def test_video_export_preview_select_create_idempotency_and_cancel() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post("/v1/galgame-workshop/projects", json={"title": "路线视频导出"})
        assert created.status_code == 200, created.text
        project_id = created.json()["id"]
        saved = await client.put(
            f"/v1/galgame-workshop/projects/{project_id}/story",
            json={"expected_revision": 0, "document": playable_story()},
        )
        assert saved.status_code == 200, saved.text
        revision = saved.json()["revision"]
        preview_body = {
            "expectedStoryRevision": revision,
            "locale": "zh",
            "preset": "1080p30",
            "branchSelections": [],
        }
        pending = await client.post(
            f"/v1/galgame-workshop/projects/{project_id}/video-exports/preview",
            json=preview_body,
        )
        assert pending.status_code == 200, pending.text
        assert pending.json()["ready"] is False
        assert pending.json()["nextDecision"]["branchBlockId"] == "block-branch"

        preview_body["branchSelections"] = [
            {"branchBlockId": "block-branch", "choiceId": "choice-device"}
        ]
        ready = await client.post(
            f"/v1/galgame-workshop/projects/{project_id}/video-exports/preview",
            json=preview_body,
        )
        assert ready.status_code == 200, ready.text
        manifest = ready.json()
        assert manifest["ready"] is True
        assert manifest["route"]["endingLabel"] == "设备的答案"
        assert manifest["route"]["branchBlockIds"] == ["block-branch"]
        assert manifest["route"]["estimatedDurationMs"] >= 2000

        request = {
            **preview_body,
            "requestId": "video-export-test",
            "previewFingerprint": manifest["previewFingerprint"],
        }
        task_response = await client.post(
            f"/v1/galgame-workshop/projects/{project_id}/video-exports",
            json=request,
        )
        assert task_response.status_code == 202, task_response.text
        task = task_response.json()
        assert task["status"] == "queued"
        repeated = await client.post(
            f"/v1/galgame-workshop/projects/{project_id}/video-exports",
            json=request,
        )
        assert repeated.status_code == 202
        assert repeated.json()["id"] == task["id"]

        listed = await client.get(f"/v1/galgame-workshop/projects/{project_id}/video-exports")
        assert listed.status_code == 200
        assert listed.json()["items"][0]["id"] == task["id"]
        cancelled = await client.post(
            f"/v1/galgame-workshop/projects/{project_id}/video-exports/{task['id']}/cancel"
        )
        assert cancelled.status_code == 200
        assert cancelled.json()["status"] == "cancelled"


@pytest.mark.asyncio
async def test_video_export_rejects_stale_story_preview() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "过期视频预览"})
        ).json()
        response = await client.post(
            f"/v1/galgame-workshop/projects/{project['id']}/video-exports/preview",
            json={
                "expectedStoryRevision": 99,
                "locale": "zh",
                "preset": "720p30",
                "branchSelections": [],
            },
        )
        assert response.status_code == 200
        assert response.json()["ready"] is False
        assert response.json()["blockers"][0]["code"] == "story_revision_conflict"


def test_video_export_registers_outputs_with_a_supported_packaging_policy() -> None:
    assert EXPORT_PACKAGING_POLICY in {"auto", "include", "exclude"}
