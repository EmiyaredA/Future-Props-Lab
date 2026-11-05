import json
from datetime import timedelta
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete

from studio.apps.model_service.providers._senseaudio import ProviderTaskStatus
from studio.apps.model_service.providers.zealman_video import create_task
from studio.apps.model_service.providers.zealman_workflows import U06, U17
from studio.apps.model_service.storage.models.model_service import ModelEntry, ModelProvider
from studio.apps.visual_workshop.storage.models import VisualGenerationTask
from studio.apps.visual_workshop.website.generation_runner import VisualGenerationRunner
from studio.config.settings import get_settings
from studio.contracts.model_service.task_execution import TaskExecutionInfo
from studio.contracts.model_service.workflow_video import WorkflowVideoParameters
from studio.runtime.time import utc_now
from website_test_support import SessionLocal, app


@pytest.mark.asyncio
@pytest.mark.parametrize("slug", [U06, U17])
async def test_workshop_keyless_workflow_references_completion_and_recovery(monkeypatch, slug):
    submitted, uploaded, requests = [], [], []
    polls = 0

    async def upload(**kwargs):
        uploaded.append(kwargs)
        return kwargs["path"].name

    async def submit(**kwargs):
        submitted.append(kwargs)
        return await create_task(**kwargs, transport=httpx.MockTransport(respond))

    def respond(request):
        requests.append(request)
        assert request.method == "POST" and request.url.path == "/api/workflow/generate"
        return httpx.Response(200, json={"prompt_id": "remote-workflow-task"})

    async def poll(**kwargs):
        nonlocal polls
        polls += 1
        assert kwargs["task_id"] == "remote-workflow-task"
        if polls == 1:
            return ProviderTaskStatus(
                "processing",
                execution_info=TaskExecutionInfo(
                    phase="running",
                    node_id="7",
                    step=8,
                    total_steps=10,
                    reported_progress=5,
                    updated_at=utc_now(),
                ),
            )
        return ProviderTaskStatus("completed", 100, "https://example.test/result.mp4")

    async def allow(_url):
        pass

    monkeypatch.setattr(
        "studio.apps.model_service.generation.visual_submission.upload_reference", upload
    )
    monkeypatch.setattr(
        "studio.apps.model_service.generation.visual_submission.create_task", submit
    )
    monkeypatch.setattr("studio.apps.visual_workshop.website.generation_runner.get_task", poll)
    monkeypatch.setattr("studio.apps.model_service.generation.media.assert_public_https", allow)
    provider = ModelProvider(
        owner_user_id="test-user",
        id=str(uuid4()),
        name="ZEALMAN Workshop",
        kind="zealman_video",
        base_url="https://example.test",
        api_key_ciphertext="",
        enabled=True,
    )
    model = ModelEntry(
        owner_user_id="test-user",
        id=str(uuid4()),
        provider_id=provider.id,
        slug=slug,
        label=slug,
        capabilities=["video_generation"],
        enabled=True,
    )
    async with SessionLocal() as session:
        session.add(provider)
        await session.commit()
        session.add(model)
        await session.commit()
    project_id = None
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            options = (await client.get("/v1/visual-workshop/generation-options")).json()
            selected = next(x for x in options["models"] if x["id"] == model.id)
            assert selected["kind"] == "video"
            assert selected["workflow_capabilities"]["reference_limits"]["video"] == (slug == U17)
            response = await client.post(
                "/v1/visual-workshop/projects", json={"title": "Workflow test", "kind": "video"}
            )
            project_id = response.json()["id"]
            base = f"/v1/visual-workshop/projects/{project_id}/generation-tasks"
            for fields in (
                {"duration": 2},
                {"resolution": "720p"},
                {"workflow_parameters": {"width": 641}},
                {"workflow_parameters": {"unknown": 1}},
            ):
                response = await client.post(
                    base,
                    json={
                        "kind": "video",
                        "model_id": model.id,
                        "prompt": "test",
                        **fields,
                    },
                )
                assert response.status_code == 422, response.text

            async def asset(filename, content, mime):
                response = await client.post(
                    "/v1/files",
                    data={"project_id": project_id},
                    files={"upload": (filename, content, mime)},
                )
                assert response.status_code == 200, response.text
                return response.json()["id"]

            image1 = await asset("one.png", b"\x89PNG\r\n\x1a\none", "image/png")
            image2 = await asset("two.png", b"\x89PNG\r\n\x1a\ntwo", "image/png")
            audio = await asset("audio.mp3", b"ID3test", "audio/mpeg")
            video = await asset("video.mp4", b"\x00\x00\x00\x18ftypisomtest", "video/mp4")
            response = await client.post(
                base,
                json={
                    "kind": "video",
                    "model_id": model.id,
                    "prompt": "audio alone",
                    "mode": "reference",
                    "audio_asset_ids": [audio],
                },
            )
            assert response.status_code == 422
            canvas = await client.put(
                f"/v1/visual-workshop/projects/{project_id}/canvas",
                json={
                    "expected_revision": 0,
                    "nodes": [
                        {
                            "id": "target",
                            "kind": "video",
                            "title": "Output",
                            "position": {"x": 0, "y": 0},
                        }
                    ],
                    "edges": [],
                },
            )
            assert canvas.status_code == 200, canvas.text
            response = await client.post(
                base,
                json={
                    "kind": "video",
                    "model_id": model.id,
                    "prompt": "test",
                    "mode": "reference",
                    "video_asset_ids": [video, image1] if slug == U17 else [video],
                },
            )
            assert response.status_code == 422
            response = await client.post(
                base,
                json={
                    "kind": "video",
                    "model_id": model.id,
                    "prompt": "actual prompt",
                    "canvas_node_id": "target",
                    "expected_canvas_revision": canvas.json()["revision"],
                    "workflow_parameters": WorkflowVideoParameters(
                        **({"width": 640} if slug == U06 else {"megapixels": 0.5})
                    ).model_dump(mode="json"),
                    "mode": "reference",
                    "reference_asset_ids": [image2, image1],
                    "audio_asset_ids": [audio],
                    "video_asset_ids": [video] if slug == U17 else [],
                },
            )
            assert response.status_code == 200, response.text
            task = response.json()
            payload = task["request_payload"]
            assert payload["reference_asset_ids"] == [image2, image1]
            assert "watermark" not in payload
            if slug == U06:
                assert isinstance(payload["workflow_parameters"]["seed"], int)
                assert "ratio" not in payload
            runner = VisualGenerationRunner(
                download_transport=httpx.MockTransport(
                    lambda _: httpx.Response(
                        200,
                        content=b"\x00\x00\x00\x18ftypisomtest",
                        headers={"content-type": "video/mp4"},
                    )
                ),
                session_factory=SessionLocal,
                settings=get_settings(),
            )
            await runner._process_task(task["id"])
            await runner._process_task(task["id"])
            current = (
                await client.get(f"/v1/visual-workshop/generation-tasks/{task['id']}")
            ).json()
            assert current["status"] == "processing" and current["progress"] == 0
            assert current["execution_info"]["step"] == 8
            assert current["execution_info"]["updated_at"].endswith("Z")
            assert current["execution_info"]["reported_progress"] == 5
            assert len(submitted) == 1
            assert submitted[-1]["api_key"] == ""
            assert submitted[-1]["payload"]["prompt"] == "actual prompt"
            assert submitted[-1]["payload"]["workflow_parameters"] == payload["workflow_parameters"]
            assert len(uploaded) == (4 if slug == U17 else 3)
            assert len(submitted[-1]["references"]["image"]) == 2
            wire = json.loads(requests[-1].content)
            assert "workflow_template" not in wire
            assert wire["input_values"]["ref_image_0"] == uploaded[0]["path"].name
            assert wire["input_values"]["ref_image_1"] == uploaded[1]["path"].name
            assert wire["input_values"]["ref_audio_0"] == uploaded[2]["path"].name
            if slug == U17:
                assert wire["input_values"]["ref_video_0"] == uploaded[3]["path"].name
            else:
                assert "ref_video_0" not in wire["input_values"]
            await runner.recover()
            await runner._process_task(task["id"])
            completed = (
                await client.get(f"/v1/visual-workshop/generation-tasks/{task['id']}")
            ).json()
            assert completed["status"] == "completed", completed
            assert completed["result_asset_id"]
            content = await client.get(f"/v1/files/{completed['result_asset_id']}/content")
            assert content.status_code == 200
            assert content.headers["content-type"].startswith("video/mp4")
            assert len(submitted) == 1
            async with SessionLocal() as session:
                row = await session.get(VisualGenerationTask, task["id"])
                row.status = "submitting"
                await session.commit()
            await runner.recover()
            await runner._process_task(task["id"])
            assert len(submitted) == 1
            assert len(requests) == 1
            async with SessionLocal() as session:
                row = await session.get(VisualGenerationTask, task["id"])
                row.status = "pending"
                row.submitted_at = utc_now() - timedelta(hours=2)
                await session.commit()
            await runner._process_task(task["id"])
            expired = (
                await client.get(f"/v1/visual-workshop/generation-tasks/{task['id']}")
            ).json()
            assert "60 分钟" in expired["error_message"]
    finally:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            if project_id:
                await client.delete(f"/v1/visual-workshop/projects/{project_id}")
        async with SessionLocal() as session:
            await session.execute(delete(ModelEntry).where(ModelEntry.id == model.id))
            await session.execute(delete(ModelProvider).where(ModelProvider.id == provider.id))
            await session.commit()
