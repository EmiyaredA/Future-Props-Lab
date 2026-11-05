from __future__ import annotations

from types import SimpleNamespace

import httpx
import pytest

from studio.apps.galgame_workshop.video.video_export import EXPORT_PACKAGING_POLICY
from studio.apps.galgame_workshop.video.video_export_runner import _recover_interrupted_task
from studio.apps.galgame_workshop.video.video_handoff_runner import GalgameVideoEditorHandoffRunner
from studio.config.settings import get_settings
from test_galgame_workshop import playable_story
from website_test_support import SessionLocal, app


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

        custom_frame = await client.post(
            f"/v1/galgame-workshop/projects/{project_id}/video-exports/preview",
            json={
                **preview_body,
                "captureFrame": {"x": 160, "y": 90, "width": 1600, "height": 900},
            },
        )
        assert custom_frame.status_code == 200, custom_frame.text
        assert custom_frame.json()["previewFingerprint"] != manifest["previewFingerprint"]

        fragment_preview = await client.post(
            f"/v1/galgame-workshop/projects/{project_id}/video-exports/preview",
            json={
                "expectedStoryRevision": revision,
                "locale": "zh",
                "preset": "1080p30",
                "scope": "fragments",
                "fragmentIds": ["main", "device-ending"],
                "branchSelections": [],
            },
        )
        assert fragment_preview.status_code == 200, fragment_preview.text
        fragment_manifest = fragment_preview.json()
        assert fragment_manifest["ready"] is True
        assert fragment_manifest["nextDecision"] is None
        assert fragment_manifest["route"]["fragmentIds"] == ["main", "device-ending"]
        assert fragment_manifest["route"]["branchBlockIds"] == []
        assert fragment_manifest["route"]["endingLabel"] == "2 个片段"
        assert len(fragment_manifest["route"]["fragmentDurationsMs"]) == 2
        assert (
            sum(fragment_manifest["route"]["fragmentDurationsMs"])
            == fragment_manifest["route"]["estimatedDurationMs"]
        )

        single_fragment = await client.post(
            f"/v1/galgame-workshop/projects/{project_id}/video-exports/preview",
            json={
                "expectedStoryRevision": revision,
                "locale": "zh",
                "preset": "720p30",
                "scope": "fragments",
                "fragmentIds": ["device-ending"],
            },
        )
        assert single_fragment.status_code == 200, single_fragment.text
        assert single_fragment.json()["route"]["endingLabel"] == "设备结局"

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
        assert cancelled.json()["cancelRequested"] is True


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


@pytest.mark.asyncio
async def test_timed_route_export_reports_return_to_entry_loop() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "循环路线"})
        ).json()
        document = playable_story()
        main = document["chapters"][0]["fragments"][0]
        main["timeline"] = {"durationMs": 3000}
        main["blocks"] = [{"id": "return", "type": "returnToEntry"}]
        saved = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 0, "document": document},
        )
        assert saved.status_code == 200, saved.text

        preview = await client.post(
            f"/v1/galgame-workshop/projects/{project['id']}/video-exports/preview",
            json={"expectedStoryRevision": saved.json()["revision"]},
        )
        assert preview.status_code == 200, preview.text
        assert preview.json()["ready"] is False
        assert preview.json()["blockers"][0]["code"] == "return_to_entry_loop"


def test_video_export_registers_outputs_with_a_supported_packaging_policy() -> None:
    assert EXPORT_PACKAGING_POLICY in {"auto", "include", "exclude"}


def test_video_export_recovery_preserves_running_cancellation() -> None:
    task = SimpleNamespace(
        cancel_requested=True,
        status="running",
        progress=4,
        result_detail={"phase": "rendering"},
        finished_at=None,
        revision=7,
        updated_at=None,
    )

    _recover_interrupted_task(task)

    assert task.status == "cancelled"
    assert task.progress == 0
    assert task.result_detail["phase"] == "cancelled"
    assert task.finished_at is not None
    assert task.revision == 8


@pytest.mark.asyncio
async def test_video_export_capture_frame_validation_and_legacy_default() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "取景校验"})
        ).json()
        endpoint = f"/v1/galgame-workshop/projects/{project['id']}/video-exports/preview"
        legacy = await client.post(endpoint, json={"expectedStoryRevision": 0})
        assert legacy.status_code == 200, legacy.text
        invalid_ratio = await client.post(
            endpoint,
            json={
                "expectedStoryRevision": 0,
                "captureFrame": {"x": 0, "y": 0, "width": 1000, "height": 600},
            },
        )
        assert invalid_ratio.status_code == 422
        invalid_bounds = await client.post(
            endpoint,
            json={
                "expectedStoryRevision": 0,
                "captureFrame": {"x": 322, "y": 180, "width": 1600, "height": 900},
            },
        )
        assert invalid_bounds.status_code == 422


@pytest.mark.asyncio
async def test_video_export_fragment_scope_validates_selection() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "片段选择校验"})
        ).json()
        empty = await client.post(
            f"/v1/galgame-workshop/projects/{project['id']}/video-exports/preview",
            json={
                "expectedStoryRevision": 0,
                "scope": "fragments",
                "fragmentIds": [],
            },
        )
        assert empty.status_code == 422

        missing = await client.post(
            f"/v1/galgame-workshop/projects/{project['id']}/video-exports/preview",
            json={
                "expectedStoryRevision": 0,
                "scope": "fragments",
                "fragmentIds": ["missing-fragment"],
            },
        )
        assert missing.status_code == 200
        assert missing.json()["ready"] is False
        assert any(
            issue["code"] == "missing_selected_fragment" for issue in missing.json()["blockers"]
        )


@pytest.mark.asyncio
async def test_video_export_clip_preview_and_create() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "快速试片"})
        ).json()
        document = playable_story()
        main = document["chapters"][0]["fragments"][0]
        main["timeline"] = {"durationMs": 1_780_000}
        main["blocks"][0]["atMs"] = 0
        main["blocks"][1].update({"startMs": 600_000, "endMs": 612_000})
        saved = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 0, "document": document},
        )
        assert saved.status_code == 200, saved.text
        revision = saved.json()["revision"]
        preview_body = {
            "expectedStoryRevision": revision,
            "scope": "clip",
            "clipRange": {
                "fragmentId": "main",
                "startMs": 600_000,
                "endMs": 610_000,
            },
        }
        preview = await client.post(
            f"/v1/galgame-workshop/projects/{project['id']}/video-exports/preview",
            json=preview_body,
        )
        assert preview.status_code == 200, preview.text
        manifest = preview.json()
        assert manifest["ready"] is True
        assert manifest["route"]["fragmentIds"] == ["main"]
        assert manifest["route"]["fragmentDurationsMs"] == [10_000]
        assert manifest["route"]["estimatedDurationMs"] == 10_000
        assert manifest["route"]["exactDuration"] is True
        assert "10m00.000s-10m10.000s" in manifest["route"]["endingLabel"]

        created = await client.post(
            f"/v1/galgame-workshop/projects/{project['id']}/video-exports",
            json={
                **preview_body,
                "requestId": "clip-export-test",
                "previewFingerprint": manifest["previewFingerprint"],
            },
        )
        assert created.status_code == 202, created.text
        assert created.json()["totalMs"] == 10_000

        stale = await client.post(
            f"/v1/galgame-workshop/projects/{project['id']}/video-exports",
            json={
                **preview_body,
                "clipRange": {**preview_body["clipRange"], "endMs": 611_000},
                "requestId": "clip-stale-preview",
                "previewFingerprint": manifest["previewFingerprint"],
            },
        )
        assert stale.status_code == 409
        assert stale.json()["code"] == "preview_conflict"


@pytest.mark.asyncio
async def test_video_export_clip_rejects_invalid_ranges() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "试片范围校验"})
        ).json()
        document = playable_story()
        main = document["chapters"][0]["fragments"][0]
        main["timeline"] = {"durationMs": 30_000}
        main["blocks"][0]["atMs"] = 0
        main["blocks"][1].update({"startMs": 1_000, "endMs": 5_000})
        saved = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 0, "document": document},
        )
        assert saved.status_code == 200, saved.text
        revision = saved.json()["revision"]
        endpoint = f"/v1/galgame-workshop/projects/{project['id']}/video-exports/preview"

        for fragment_id, start_ms, end_ms, code in (
            ("missing-fragment", 0, 1000, "missing_clip_fragment"),
            ("device-ending", 0, 1000, "clip_fragment_without_timeline"),
            ("main", 29_000, 31_000, "clip_range_out_of_bounds"),
        ):
            response = await client.post(
                endpoint,
                json={
                    "expectedStoryRevision": revision,
                    "scope": "clip",
                    "clipRange": {
                        "fragmentId": fragment_id,
                        "startMs": start_ms,
                        "endMs": end_ms,
                    },
                },
            )
            assert response.status_code == 200, response.text
            assert response.json()["ready"] is False
            assert any(issue["code"] == code for issue in response.json()["blockers"])

        for start_ms, end_ms in ((1000, 1000), (0, 300_001)):
            response = await client.post(
                endpoint,
                json={
                    "expectedStoryRevision": revision,
                    "scope": "clip",
                    "clipRange": {
                        "fragmentId": "main",
                        "startMs": start_ms,
                        "endMs": end_ms,
                    },
                },
            )
            assert response.status_code == 422


@pytest.mark.asyncio
async def test_video_editor_handoff_is_idempotent_and_cancellable() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "剪辑交接"})
        ).json()
        saved = await client.put(
            f"/v1/galgame-workshop/projects/{project['id']}/story",
            json={"expected_revision": 0, "document": playable_story()},
        )
        assert saved.status_code == 200, saved.text
        preview_body = {
            "expectedStoryRevision": saved.json()["revision"],
            "preset": "720p60",
            "branchSelections": [{"branchBlockId": "block-branch", "choiceId": "choice-device"}],
        }
        preview = await client.post(
            f"/v1/galgame-workshop/projects/{project['id']}/video-exports/preview",
            json=preview_body,
        )
        assert preview.status_code == 200, preview.text
        request = {
            **preview_body,
            "requestId": "handoff-test-request",
            "previewFingerprint": preview.json()["previewFingerprint"],
        }
        created = await client.post(
            f"/v1/galgame-workshop/projects/{project['id']}/video-editor-handoffs",
            json=request,
        )
        assert created.status_code == 202, created.text
        repeated = await client.post(
            f"/v1/galgame-workshop/projects/{project['id']}/video-editor-handoffs",
            json=request,
        )
        assert repeated.status_code == 202
        assert repeated.json()["id"] == created.json()["id"]
        listed = await client.get(
            f"/v1/galgame-workshop/projects/{project['id']}/video-editor-handoffs"
        )
        assert listed.status_code == 200
        assert listed.json()["items"][0]["id"] == created.json()["id"]
        cancelled = await client.post(
            f"/v1/galgame-workshop/projects/{project['id']}/video-editor-handoffs/"
            f"{created.json()['id']}/cancel"
        )
        assert cancelled.status_code == 200
        assert cancelled.json()["status"] == "cancelled"

        materialize_request = {**request, "requestId": "handoff-materialize-test"}
        materialize = await client.post(
            f"/v1/galgame-workshop/projects/{project['id']}/video-editor-handoffs",
            json=materialize_request,
        )
        assert materialize.status_code == 202, materialize.text
        await GalgameVideoEditorHandoffRunner(
            session_factory=SessionLocal, settings=get_settings()
        )._process(materialize.json()["id"])
        completed = await client.get(
            f"/v1/galgame-workshop/projects/{project['id']}/video-editor-handoffs/"
            f"{materialize.json()['id']}"
        )
        assert completed.status_code == 200, completed.text
        assert completed.json()["status"] == "completed", completed.json().get("error")
        output_project_id = completed.json()["outputProjectId"]
        editor_project = await client.get(f"/v1/video-editor/projects/{output_project_id}")
        assert editor_project.status_code == 200, editor_project.text
        assert editor_project.json()["sourceApplication"] == "galgame-workshop"
        assert editor_project.json()["sourceRevision"] == saved.json()["revision"]
        timeline = await client.get(f"/v1/video-editor/projects/{output_project_id}/timeline")
        assert timeline.status_code == 200, timeline.text
        assert any(track["name"] == "对白 UI" for track in timeline.json()["document"]["tracks"])
