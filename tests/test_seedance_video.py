import json
import wave
from dataclasses import replace
from uuid import uuid4

import httpx
import pytest
from PIL import Image
from tests.test_generation_task_driver import FakeStore, _driver, _task

from app.runtime.credentials import encrypt_secret
from studio.apps.asset_library.storage.models import VisualAsset
from studio.apps.model_service.inference.catalog import normalize_parameters
from studio.apps.model_service.playground.generation import ModelTestGeneration
from studio.apps.model_service.providers.seedance_parameters import (
    normalize_video_parameters,
    video_capabilities,
)
from studio.apps.model_service.providers.seedance_references import (
    SeedanceReference,
    validate_seedance_references,
)
from studio.apps.model_service.providers.volcengine_video import create_task, get_task
from studio.apps.model_service.storage.models.model_service import ModelEntry, ModelProvider
from studio.apps.model_service.storage.models.model_test import (
    ModelTestGenerationAsset,
    ModelTestGenerationTask,
)
from studio.apps.visual_workshop.storage.models import VisualWorkshopProject
from studio.apps.visual_workshop.website.generation import GenerationError, VisualGeneration
from studio.assembly.website.models import bind_owner
from studio.config.settings import get_settings
from studio.contracts.model_service.generation_tasks import VideoGenerationTaskCreateIn
from studio.contracts.model_service.schemas.model_inference import InferenceTaskIn
from studio.contracts.model_service.schemas.model_service import ProviderIn
from studio.contracts.model_service.schemas.model_test import ModelTestVideoGenerationIn
from studio.runtime.database.operation_receipts import OperationError
from website_test_support import SessionLocal

V20 = "doubao-seedance-2-0-260128"
V25 = "doubao-seedance-2-5-260628"


@pytest.mark.asyncio
@pytest.mark.parametrize("slug,duration", [(V20, 15), (V25, 30)])
async def test_native_creation_converts_roles_preserves_order_and_uses_official_defaults(
    slug, duration
):
    requests = []

    def handle(request):
        requests.append(request)
        assert request.headers["authorization"] == "Bearer fake"
        return httpx.Response(200, json={"id": "remote-1"})

    content = [
        {"type": "text", "text": "实际提示词"},
        {"type": "image", "url": "data:image/png;base64,AA==", "role": "reference"},
        {"type": "audio", "audio_url": "data:audio/wav;base64,AA=="},
        {"type": "video", "video_url": "https://media.example/ref.mp4"},
    ]
    original = json.dumps(content)
    result = await create_task(
        base_url="",
        api_key="fake",
        model=slug,
        payload={"duration": duration, "mode": "reference"},
        content=content,
        transport=httpx.MockTransport(handle),
    )
    assert result == "remote-1" and json.dumps(content) == original
    assert (
        str(requests[0].url)
        == "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks"
    )
    body = json.loads(requests[0].content)
    assert body["generate_audio"] is True and body["watermark"] is True
    assert body["content"][1] == {
        "type": "image_url",
        "image_url": {"url": content[1]["url"]},
        "role": "reference_image",
    }
    assert body["content"][2]["role"] == "reference_audio"
    assert body["content"][3]["video_url"]["url"].endswith("ref.mp4")
    assert "provider_specific" not in body and "seed" not in body
    if slug == V25:
        assert body["output_format"] == "mp4" and body["omni_reference_task_type"] == "reference"


@pytest.mark.asyncio
async def test_first_last_frame_wire_and_no_implicit_post_retry():
    sent = []

    def handle(request):
        sent.append(json.loads(request.content))
        return httpx.Response(429, json={"error": {"message": "Bearer secret api_key=secret"}})

    with pytest.raises(ValueError, match="REDACTED"):
        await create_task(
            base_url="https://ark.example/api/v3",
            api_key="fake",
            model=V25,
            payload={"duration": -1, "mode": "frames", "ratio": "adaptive"},
            content=[
                {"type": "image", "url": "first", "role": "first_frame"},
                {"type": "image", "url": "last", "role": "last_frame"},
            ],
            transport=httpx.MockTransport(handle),
        )
    assert len(sent) == 1
    assert [r["role"] for r in sent[0]["content"]] == ["first_frame", "last_frame"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "remote,local",
    [
        ("queued", "pending"),
        ("running", "processing"),
        ("succeeded", "completed"),
        ("failed", "failed"),
        ("cancelled", "failed"),
        ("expired", "failed"),
    ],
)
async def test_remote_status_is_normalized(remote, local):
    def handle(request):
        assert str(request.url).endswith("/contents/generations/tasks/remote-1")
        return httpx.Response(
            200, json={"status": remote, "content": {"video_url": "https://cdn.example/out.mp4"}}
        )

    state = await get_task(
        base_url="https://ark.example/api/v3",
        api_key="fake",
        task_id="remote-1",
        transport=httpx.MockTransport(handle),
    )
    assert state.status == local
    assert state.progress == (100 if remote == "succeeded" else 0)
    if remote in {"expired", "cancelled"}:
        assert state.error_message


@pytest.mark.parametrize(
    "slug,params",
    [
        (V20, {"duration": 30}),
        (V25, {"duration": 0}),
        (V25, {"duration": 31}),
        (V25, {"resolution": "4k"}),
        (V20, {"reference_asset_ids": list(range(10))}),
        (V25, {"reference_asset_ids": list(range(31))}),
        (V20, {"audio_asset_ids": ["a"]}),
        (V25, {"mode": "frames", "ratio": "16:9"}),
    ],
)
def test_version_policy_rejects_invalid_combinations(slug, params):
    with pytest.raises(ValueError):
        normalize_video_parameters("volcengine_video", slug, params)


def test_version_capabilities_and_legacy_boundaries():
    assert video_capabilities("volcengine_video", V25).reference_limits == {
        "image": 30,
        "video": 10,
        "audio": 10,
    }
    assert (
        normalize_video_parameters(
            "volcengine_video", V25, {"audio_asset_ids": ["a"], "duration": -1}
        )["duration"]
        == -1
    )
    assert (
        normalize_video_parameters("volcengine_video", V20, {"resolution": "4k"})["resolution"]
        == "4k"
    )
    for params in ({"duration": 30}, {"ratio": "adaptive"}, {"audio_asset_ids": ["a"]}):
        with pytest.raises(ValueError):
            normalize_video_parameters("senseaudio_video", V20, params)
    provider = ProviderIn(name="Ark", kind="volcengine_video", expected_catalog_revision=0)
    assert provider.base_url == "https://ark.cn-beijing.volces.com/api/v3"


def test_independent_inference_uses_identical_video_version_rules():
    from types import SimpleNamespace

    provider = SimpleNamespace(kind="volcengine_video")
    body = InferenceTaskIn(
        request_id="request",
        model_id="model",
        kind="video",
        parameters={"prompt": "test", "duration": 30},
    )
    result = normalize_parameters(body, SimpleNamespace(id="model", slug=V25), provider, [])
    assert result["duration"] == 30 and result["generate_audio"] is True
    with pytest.raises(OperationError):
        normalize_parameters(body, SimpleNamespace(id="model", slug=V20), provider, [])


@pytest.mark.asyncio
async def test_all_video_entry_points_inline_ark_audio_and_preserve_provider_neutral_content(
    monkeypatch,
):
    from studio.apps.model_service.generation import visual_submission as visual_submission
    from studio.apps.model_service.inference import runner as inference_runner
    from studio.apps.model_service.playground import generation_runner as test_runner
    from studio.apps.visual_workshop.website import generation_runner as visual_runner

    captured = []

    async def submit(**kwargs):
        captured.append(kwargs["video_content"])
        return "remote"

    async def data_uri(*_args, **_kwargs):
        return "data:audio/wav;base64,AA=="

    async def forbidden_upload(*_args, **_kwargs):
        raise AssertionError("Ark audio must not use the temporary upload service")

    monkeypatch.setattr(visual_submission, "submit_generation_task", submit)
    monkeypatch.setattr(test_runner, "submit_generation_task", submit)
    monkeypatch.setattr(inference_runner, "submit_generation_task", submit)
    visual = visual_runner.VisualGenerationRunner(
        session_factory=SessionLocal, settings=get_settings()
    )
    playground = test_runner.ModelTestGenerationRunner(SessionLocal)
    inference = inference_runner.InferenceRunner(SessionLocal)
    monkeypatch.setattr(visual, "_asset_data_uri", data_uri)
    monkeypatch.setattr(visual, "_temporary_asset_url", forbidden_upload)
    monkeypatch.setattr(playground, "_asset_data_uri", data_uri)
    monkeypatch.setattr(playground, "_temporary_asset_url", forbidden_upload)
    monkeypatch.setattr(inference_runner, "read_data_uri", data_uri)

    async def inputs(_task):
        return {"audio": (None, "audio/wav", "voice.wav", 4)}

    monkeypatch.setattr(inference, "inputs", inputs)
    task = _task("queued", provider_kind="volcengine_video")
    task = replace(
        task,
        model_slug=V25,
        payload={"mode": "reference", "prompt": "audio", "audio_asset_ids": ["audio"]},
    )
    await visual._submit_context(task)
    await playground._submit_context(task)
    await inference.submit(task)
    assert len(captured) == 3
    assert all(
        content[1] == {"type": "audio", "audio_url": "data:audio/wav;base64,AA=="}
        for content in captured
    )


@pytest.mark.asyncio
async def test_reference_preflight_checks_actual_files_and_config_before_submission(tmp_path):
    picture = tmp_path / "image.png"
    Image.new("RGB", (512, 512)).save(picture)
    audio = tmp_path / "voice.wav"
    with wave.open(str(audio), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(8000)
        wav.writeframes(b"\x00\x00" * 8000 * 2)
    refs = [
        SeedanceReference("image", "image/png", picture),
        SeedanceReference("audio", "audio/wav", audio),
    ]
    await validate_seedance_references(V25, {}, refs, "")
    with pytest.raises(ValueError, match="temp_media_upload_url"):
        await validate_seedance_references(
            V25, {}, [SeedanceReference("video", "video/mp4", tmp_path / "missing")], ""
        )
    Image.new("RGB", (64, 64)).save(picture)
    with pytest.raises(ValueError, match="300"):
        await validate_seedance_references(V20, {}, refs[:1], "")
    with pytest.raises(ValueError, match="累计时长"):
        await validate_seedance_references(V20, {}, [refs[1]] * 8, "")


@pytest.mark.asyncio
async def test_ark_driver_recovers_without_resubmitting_and_retries_materialization_only():
    store = FakeStore(_task("pending", provider_kind="volcengine_video", provider_task_id="remote"))
    submits, polls, saves = [], [], []

    async def submit(task):
        submits.append(task)
        raise AssertionError("must not resubmit")

    async def poll(task):
        from studio.apps.model_service.providers._senseaudio import ProviderTaskStatus

        polls.append(task)
        return ProviderTaskStatus(status="completed", result_url="https://cdn.example/out.mp4")

    async def materialize(_task_id, url):
        saves.append(url)
        store.task = replace(store.task, status="completed")

    driver = _driver(store, submit=submit, poll=poll, materialize=materialize)
    await driver.recover()
    await driver.process("task-1")
    assert not submits and len(polls) == 1 and len(saves) == 1
    store.task = _task("processing", provider_kind="volcengine_video", result_url=saves[0])
    await driver.process("task-1")
    assert len(saves) == 2 and len(polls) == 1
    store.task = _task("submitting", provider_kind="volcengine_video")
    await driver.recover()
    await driver.process("task-1")
    assert store.task.status == "failed" and not submits


@pytest.mark.asyncio
async def test_workshop_and_model_test_options_and_admission_use_version_capabilities():
    async with SessionLocal() as session:
        bind_owner(session, "test-user")
        provider = ModelProvider(
            owner_user_id="test-user",
            id=str(uuid4()),
            name="Ark fixture",
            kind="volcengine_video",
            base_url="https://ark.example/api/v3",
            api_key_ciphertext=encrypt_secret("fake"),
        )
        project = VisualWorkshopProject(
            owner_user_id="test-user", id=str(uuid4()), title="Ark test", kind="video"
        )
        session.add_all([provider, project])
        await session.flush()
        model = ModelEntry(
            owner_user_id="test-user",
            id=str(uuid4()),
            provider_id=provider.id,
            slug=V25,
            label="Seedance 2.5",
            capabilities=["video_generation"],
        )
        session.add(model)
        await session.commit()
        pid, mid = project.id, model.id
        generation = VisualGeneration(session)
        options = await generation.options()
        assert next(m for m in options.models if m.id == mid).video_capabilities.duration_max == 30
        test = ModelTestGeneration(session, "test-user")
        assert next(
            m for m in (await test.options()).items if m.id == mid
        ).video_capabilities.audio_only
        row = await generation.prepare_create(
            pid,
            VideoGenerationTaskCreateIn(
                kind="video", model_id=mid, prompt="30 seconds", duration=30
            ),
        )
        assert row.request_payload["generate_audio"] is True
        await session.rollback()
        with pytest.raises(GenerationError, match="不支持所选分辨率"):
            await generation.prepare_create(
                pid,
                VideoGenerationTaskCreateIn(
                    kind="video", model_id=mid, prompt="4k", resolution="4k"
                ),
            )
        # Test assets must be scoped to this project before any provider request.
        asset = VisualAsset(
            owner_user_id="test-user",
            id=str(uuid4()),
            project_id=None,
            media_kind="image",
            original_filename="outside.png",
            display_name="outside",
            mime_type="image/png",
            byte_size=1,
            storage_key=str(uuid4()),
        )
        session.add(asset)
        await session.flush()
        with pytest.raises(GenerationError, match="不属于当前项目"):
            await generation.prepare_create(
                pid,
                VideoGenerationTaskCreateIn(
                    kind="video",
                    model_id=mid,
                    mode="frames",
                    first_frame_asset_id=asset.id,
                    ratio="adaptive",
                ),
            )
        await session.rollback()
        task = await test.create(
            ModelTestVideoGenerationIn(kind="video", model_id=mid, prompt="test", duration=30)
        )
        assert (
            task.provider_kind == "volcengine_video"
            and task.request_payload["generate_audio"] is True
        )
        pictures = []
        for name in ("first.png", "last.png"):
            private = ModelTestGenerationAsset(
                owner_user_id="test-user",
                id=str(uuid4()),
                original_filename=name,
                storage_key=str(uuid4()),
                media_kind="image",
                mime_type="image/png",
                byte_size=100,
            )
            session.add(private)
            pictures.append(private)
        await session.flush()
        root = get_settings().account_model_test_path("test-user", "references")
        root.mkdir(parents=True, exist_ok=True)
        for private in pictures:
            Image.new("RGB", (512, 512)).save(root / private.storage_key, format="PNG")
        await session.commit()
        frame_task = await test.create(
            ModelTestVideoGenerationIn(
                kind="video",
                model_id=mid,
                prompt="首尾帧",
                mode="frames",
                ratio="adaptive",
                first_frame_asset_id=pictures[0].id,
                last_frame_asset_id=pictures[1].id,
            )
        )
        assert frame_task.request_payload["first_frame_asset_id"] == pictures[0].id
        await session.refresh(pictures[0])
        await session.refresh(pictures[1])
        assert [p.position for p in pictures] == [0, 1]
        assert all(p.role == "reference_image" for p in pictures)
        from sqlalchemy import delete

        await session.execute(
            delete(ModelTestGenerationTask).where(
                ModelTestGenerationTask.id.in_([task.id, frame_task.id])
            )
        )
        await session.execute(delete(VisualWorkshopProject).where(VisualWorkshopProject.id == pid))
        await session.execute(delete(ModelProvider).where(ModelProvider.id == provider.id))
        await session.commit()
        for private in pictures:
            (root / private.storage_key).unlink(missing_ok=True)
