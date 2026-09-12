"""Public API and deterministic provider checks for independent inference."""

import copy
from uuid import uuid4

import httpx
import pytest

from app.llm.inference.runner import InferenceRunner
from app.llm.providers._senseaudio import ProviderTaskStatus
from app.main import app

CREATED_PROVIDERS = []


@pytest.fixture(autouse=True)
async def clean_owned_models():
    CREATED_PROVIDERS.clear()
    yield
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        for provider_id in CREATED_PROVIDERS:
            revision = (await client.get("/v1/model-providers")).json()["revision"]
            response = await client.delete(
                f"/v1/model-providers/{provider_id}", params={"expected_catalog_revision": revision}
            )
            assert response.status_code == 200, response.text


async def model(
    client,
    kind="senseaudio_image",
    slug="senseaudio-image-2.0-260319",
    capability="image_generation",
):
    revision = (await client.get("/v1/model-providers")).json()["revision"]
    response = await client.post(
        "/v1/model-providers",
        json={
            "expected_catalog_revision": revision,
            "name": str(uuid4()),
            "kind": kind,
            "base_url": "https://provider.invalid/v1",
            "api_key": "deterministic-secret",
            "enabled": True,
        },
    )
    assert response.status_code == 200, response.text
    provider = response.json()
    CREATED_PROVIDERS.append(provider["provider"]["id"])
    response = await client.post(
        f"/v1/model-providers/{provider['provider']['id']}/models",
        json={
            "expected_catalog_revision": provider["revision"],
            "slug": slug,
            "label": "Fixture",
            "description": "",
            "capabilities": [capability],
            "categories": [],
            "enabled": True,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["model"]["id"]


@pytest.mark.asyncio
async def test_task_idempotency_results_and_materialization_retry(monkeypatch):
    calls = []

    async def submit(**kwargs):
        calls.append(kwargs)
        return "deterministic-1"

    async def poll(**_kwargs):
        return ProviderTaskStatus(
            status="completed", result_url="https://output.invalid/result.png"
        )

    failed = True

    async def download(*, target, **_kwargs):
        if failed:
            raise ValueError("download interrupted")
        target.write_bytes(b"deterministic media")
        return 19, "image", "image/png", ".png"

    monkeypatch.setattr("app.llm.inference.runner.submit_generation_task", submit)
    monkeypatch.setattr("app.llm.inference.runner.poll_generation_task", poll)
    monkeypatch.setattr("app.llm.inference.runner.download_generated_media", download)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        identity = await model(client)
        assert identity in [
            m["id"] for m in (await client.get("/v1/model-inference/options")).json()["items"]
        ]
        body = {
            "request_id": "deterministic-1",
            "model_id": identity,
            "kind": "image",
            "parameters": {"prompt": "test", "size": "1024x1024"},
        }
        response = await client.post("/v1/model-inference/tasks", json=body)
        assert response.status_code == 200, response.text
        task = response.json()
        # Replaying an existing receipt remains possible when no new quota slot is available.
        from types import SimpleNamespace

        from app.core.db import SessionLocal
        from app.core.tenant_context import bind_workspace
        from app.routes.model_capacity import model_capacity

        async def no_capacity(*_args, **_kwargs):
            raise AssertionError("A replay must not acquire a new model quota slot")

        async def request_json():
            return body

        with monkeypatch.context() as limited:
            limited.setattr("app.routes.model_capacity.acquire", no_capacity)
            async with SessionLocal() as session:
                bind_workspace(session, "default")
                request = SimpleNamespace(
                    method="POST",
                    url=SimpleNamespace(path="/v1/model-inference/tasks"),
                    json=request_json,
                )
                capacity = model_capacity(request, SimpleNamespace(workspace_id="default"), session)
                await anext(capacity)
                await capacity.aclose()
        assert (await client.post("/v1/model-inference/tasks", json=body)).json()["id"] == task[
            "id"
        ]
        changed = copy.deepcopy(body)
        changed["parameters"]["prompt"] = "changed"
        assert (await client.post("/v1/model-inference/tasks", json=changed)).status_code == 409
        url = f"/v1/model-inference/tasks/{task['id']}"
        assert (await client.delete(url, params={"expected_revision": 0})).status_code == 409
        runner = InferenceRunner()
        await runner.process_once()
        await runner.process_once()
        task = (await client.get(url)).json()
        assert task["status"] == "failed", task
        assert task["can_retry_materialization"]
        failed = False
        retry = await client.post(
            url + "/retry-materialization", json={"expected_revision": task["revision"]}
        )
        assert retry.status_code == 200, retry.text
        await runner.process_once()
        task = (await client.get(url)).json()
        assert task["status"] == "completed", task
        assert len(calls) == 1
        assert (await client.get(url + "/content")).content == b"deterministic media"
        assert "deterministic-secret" not in str(task)
        assert (
            await client.delete(url, params={"expected_revision": task["revision"] - 1})
        ).status_code == 409
        assert (
            await client.delete(url, params={"expected_revision": task["revision"]})
        ).status_code == 204
        assert (await client.get(url)).status_code == 404


@pytest.mark.asyncio
async def test_interrupted_submission_is_not_replayed(monkeypatch):
    import asyncio

    calls = []

    async def submit(**_kwargs):
        calls.append(1)
        raise asyncio.CancelledError()

    monkeypatch.setattr("app.llm.inference.runner.submit_generation_task", submit)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        identity = await model(client)
        task = (
            await client.post(
                "/v1/model-inference/tasks",
                json={
                    "request_id": "interrupted",
                    "model_id": identity,
                    "kind": "image",
                    "parameters": {"prompt": "test", "size": "1024x1024"},
                },
            )
        ).json()
        runner = InferenceRunner()
        with pytest.raises(asyncio.CancelledError):
            await runner.process(task["id"])
        await runner.recover()
        await runner.process_once()
        task = (await client.get(f"/v1/model-inference/tasks/{task['id']}")).json()
        assert task["status"] == "failed"
        assert not task["can_retry_materialization"]
        assert calls == [1]


@pytest.mark.asyncio
async def test_text_json_and_sse_have_durable_logs(monkeypatch):
    from app.llm.providers.streaming import TextDelta

    async def stream(**_kwargs):
        yield TextDelta(text="Hello ")
        yield TextDelta(
            text="SDK", finish_reason="stop", prompt_tokens=3, completion_tokens=2, total_tokens=5
        )

    monkeypatch.setattr("app.llm.inference.text.stream_text_completion", stream)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        identity = await model(client, "openai", "fixture-chat", "chat")
        body = {"model_id": identity, "messages": [{"role": "user", "text": "Hi"}]}
        response = await client.post("/v1/model-inference/text", json=body)
        assert response.status_code == 200, response.text
        assert response.json()["text"] == "Hello SDK"
        log = (await client.get("/v1/llm-call-logs/" + response.json()["log_id"])).json()
        assert log["call_source"] == "model_inference"
        assert "deterministic-secret" not in str(log)
        response = await client.post("/v1/model-inference/text/stream", json=body)
        assert response.status_code == 200
        assert '"type":"delta"' in response.text and '"type":"done"' in response.text


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kind,provider,capability,media",
    [
        ("video", "senseaudio_video", "video_generation", "video"),
        ("music", "senseaudio_music", "audio_generation", "audio"),
        ("sound_effect", "senseaudio_sfx", "audio_generation", "audio"),
    ],
)
async def test_supported_modalities_use_shared_driver(
    monkeypatch, kind, provider, capability, media
):
    submitted = []

    async def submit(**kwargs):
        submitted.append(kwargs)
        return "provider-id"

    async def poll(**_kwargs):
        return ProviderTaskStatus(status="completed", result_url="https://output.invalid/media")

    async def download(*, target, **_kwargs):
        target.write_bytes(b"fixture")
        return (
            7,
            media,
            media + "/" + ("mp4" if media == "video" else "mpeg"),
            ".mp4" if media == "video" else ".mp3",
        )

    monkeypatch.setattr("app.llm.inference.runner.submit_generation_task", submit)
    monkeypatch.setattr("app.llm.inference.runner.poll_generation_task", poll)
    monkeypatch.setattr("app.llm.inference.runner.download_generated_media", download)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        model_id = await model(client, provider, "fixture-" + kind, capability)
        created = await client.post(
            "/v1/model-inference/tasks",
            json={
                "request_id": kind,
                "model_id": model_id,
                "kind": kind,
                "parameters": {"prompt": "fixture"},
            },
        )
        assert created.status_code == 200, created.text
        runner = InferenceRunner()
        await runner.process_once()
        await runner.process_once()
        result = (await client.get("/v1/model-inference/tasks/" + created.json()["id"])).json()
        assert result["status"] == "completed", result
        assert result["result_available"]
        assert submitted[0]["provider_kind"] == provider


@pytest.mark.asyncio
async def test_transcription_private_input_claim_download_and_cleanup(monkeypatch):
    from tests.test_audio_annotation import wav_bytes

    from app.llm.providers.transcription import TranscriptionResult, TranscriptSegment

    calls = []

    async def transcribe(**kwargs):
        calls.append(kwargs["source"].read())
        return TranscriptionResult(
            text="Hello",
            segments=(TranscriptSegment(speaker="Speaker", start_ms=0, end_ms=500, text="Hello"),),
        )

    monkeypatch.setattr("app.llm.inference.runner.transcribe_model_audio", transcribe)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        identity = await model(client, "openai", "whisper-1", "speech_recognition")
        uploaded = await client.post(
            "/v1/model-inference/assets", files={"upload": ("audio.wav", wav_bytes(), "audio/wav")}
        )
        assert uploaded.status_code == 200, uploaded.text
        asset = uploaded.json()
        created = await client.post(
            "/v1/model-inference/tasks",
            json={
                "request_id": "asr",
                "model_id": identity,
                "kind": "transcription",
                "asset_ids": [asset["id"]],
            },
        )
        assert created.status_code == 200, created.text
        task_id = created.json()["id"]
        assert (await client.delete("/v1/model-inference/assets/" + asset["id"])).status_code == 409
        assert (await client.get("/v1/files/" + asset["id"] + "/download")).status_code == 404
        await InferenceRunner().process_once()
        task = (await client.get("/v1/model-inference/tasks/" + task_id)).json()
        assert task["status"] == "completed", task
        result = await client.get("/v1/model-inference/tasks/" + task_id + "/content")
        assert result.json()["text"] == "Hello"
        assert len(calls) == 1
        assert (
            await client.delete(
                "/v1/model-inference/tasks/" + task_id,
                params={"expected_revision": task["revision"]},
            )
        ).status_code == 204


@pytest.mark.asyncio
async def test_input_commit_interruption_preserves_owned_file_and_recovery_cleans_orphans(
    monkeypatch,
):
    import asyncio

    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession
    from tests.test_audio_annotation import wav_bytes

    from app.core.db import SessionLocal
    from app.llm.inference.assets import root
    from app.models.model_inference import ModelInferenceAsset

    original_commit = AsyncSession.commit

    async def interrupted_commit(session):
        await original_commit(session)
        raise asyncio.CancelledError()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        with monkeypatch.context() as interrupted:
            interrupted.setattr(AsyncSession, "commit", interrupted_commit)
            with pytest.raises(asyncio.CancelledError):
                await client.post(
                    "/v1/model-inference/assets",
                    files={"upload": ("interrupted.wav", wav_bytes(), "audio/wav")},
                )
        async with SessionLocal() as session:
            asset = await session.scalar(
                select(ModelInferenceAsset).where(
                    ModelInferenceAsset.filename == "interrupted.wav",
                    ModelInferenceAsset.workspace_id == "default",
                )
            )
            assert asset is not None
            path = root("default") / "inputs" / asset.storage_key
            asset_id = asset.id
        assert path.is_file()
        orphan = path.parent / "uncommitted-test-file"
        orphan.write_bytes(b"orphan")
        await InferenceRunner().recover()
        assert path.is_file() and not orphan.exists()
        assert (await client.delete("/v1/model-inference/assets/" + asset_id)).status_code == 204
        assert not path.exists()
