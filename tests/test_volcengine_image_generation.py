import json
from dataclasses import replace
from uuid import uuid4

import httpx
import pytest
from tests.test_generation_task_driver import FakeStore, _driver, _task

from app.capabilities.asset_store.models import VisualAsset
from app.llm.generation_runtime import ImmediateGenerationResult
from app.llm.models import ModelEntry, ModelProvider
from app.llm.providers.volcengine_image import SEEDREAM_MODEL, generate_image
from app.runtime.credentials import encrypt_secret
from studio.apps.visual_workshop.storage.models import VisualCanvasDocument, VisualWorkshopProject
from studio.apps.visual_workshop.website.generation import GenerationError, VisualGeneration
from studio.assembly.website.models import bind_owner
from studio.contracts.model_service.generation_tasks import ImageGenerationTaskCreateIn
from website_test_support import SessionLocal


@pytest.mark.asyncio
async def test_native_image_array_order_single_output_and_errors():
    submitted = []

    async def handler(request):
        assert str(request.url) == "https://ark.example/api/v3/images/generations"
        submitted.append(json.loads(request.content))
        return httpx.Response(200, json={"data": [{"url": "https://cdn.example/output.png"}]})

    references = [f"data:image/png;base64,reference-{index}" for index in range(14)]
    result = await generate_image(
        base_url="https://ark.example/api/v3",
        api_key="fake-key",
        model=SEEDREAM_MODEL,
        payload={"prompt": "小夏和清晨场景", "size": "2048x2048"},
        references=references,
        transport=httpx.MockTransport(handler),
    )
    assert result == "https://cdn.example/output.png"
    assert submitted[0]["image"] == references
    assert submitted[0]["sequential_image_generation"] == "disabled"
    assert submitted[0]["response_format"] == "url"
    with pytest.raises(ValueError, match="14"):
        await generate_image(
            base_url="https://ark.example/api/v3",
            api_key="fake-key",
            model=SEEDREAM_MODEL,
            payload={"prompt": "test", "size": "2048x2048"},
            references=[*references, "extra"],
            transport=httpx.MockTransport(handler),
        )
    assert len(submitted) == 1


@pytest.mark.asyncio
async def test_immediate_image_result_persisted_before_materialization_and_recovery():
    store = FakeStore(_task("queued", provider_kind="volcengine_image"))
    submissions, polls, materializations = [], [], []

    async def submit(task):
        submissions.append(task)
        return ImmediateGenerationResult("https://cdn.example/output.png")

    async def poll(task):
        polls.append(task)
        raise AssertionError("同步图片不应轮询供应商")

    async def materialize(task_id, url):
        assert store.task.status == "processing" and store.task.result_url == url
        materializations.append(task_id)
        store.task = replace(store.task, status="completed")

    driver = _driver(store, submit=submit, poll=poll, materialize=materialize)
    await driver.process("task-1")
    await driver.process("task-1")
    assert len(submissions) == 1 and not polls and materializations == ["task-1"]
    store.task = _task("submitting", provider_kind="volcengine_image")
    await driver.recover()
    await driver.process("task-1")
    assert store.task.status == "failed" and len(submissions) == 1
    store.task = _task(
        "processing", provider_kind="volcengine_image", result_url="https://cdn.example/output.png"
    )
    await driver.process("task-1")
    assert len(submissions) == 1 and len(materializations) == 2


@pytest.mark.asyncio
async def test_server_validates_multi_image_order_count_format_and_submission_snapshot():
    project_id, provider_id, model_id = (str(uuid4()) for _ in range(3))
    asset_ids = [str(uuid4()) for _ in range(2)]
    async with SessionLocal() as session:
        bind_owner(session, "test-user")
        project = VisualWorkshopProject(
            id=project_id, owner_user_id="test-user", title="多图模型测试", kind="canvas"
        )
        provider = ModelProvider(
            id=provider_id,
            owner_user_id="test-user",
            name="方舟模拟",
            kind="volcengine_image",
            base_url="https://ark.example/api/v3",
            api_key_ciphertext=encrypt_secret("mock-key"),
        )
        session.add_all([project, provider])
        await session.flush()
        model = ModelEntry(
            id=model_id,
            owner_user_id="test-user",
            provider_id=provider_id,
            slug=SEEDREAM_MODEL,
            label="Seedream 4.5",
            capabilities=["image_generation"],
        )
        session.add(model)
        for identity in asset_ids:
            session.add(
                VisualAsset(
                    id=identity,
                    owner_user_id="test-user",
                    project_id=project_id,
                    media_kind="image",
                    original_filename="reference.png",
                    display_name="reference",
                    mime_type="image/png",
                    byte_size=10,
                    storage_key=identity,
                )
            )
        session.add(VisualCanvasDocument(project_id=project_id, nodes=[], edges=[]))
        await session.commit()
        from app.capabilities.asset_store.storage import AssetStorage
        from studio.config.settings import get_settings

        storage = AssetStorage(get_settings())
        for identity in asset_ids:
            asset = await session.get(VisualAsset, identity)
            path = storage.path_for(asset)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"\x89PNG\r\n\x1a\nfixture")
        generation = VisualGeneration(session)
        row = await generation.prepare_create(
            project_id,
            ImageGenerationTaskCreateIn(
                kind="image",
                model_id=model_id,
                prompt="按参考图顺序合成",
                size="2048x2048",
                reference_asset_ids=asset_ids[::-1],
            ),
        )
        assert row.request_payload["reference_asset_ids"] == asset_ids[::-1]
        assert row.request_payload["reference_asset_id"] is None
        await session.rollback()
        provider = await session.get(ModelProvider, provider_id)
        provider.kind = "senseaudio_image"
        model = await session.get(ModelEntry, model_id)
        model.slug = "senseaudio-image-2.0-260319"
        await session.commit()
        with pytest.raises(GenerationError, match="数量"):
            await generation.prepare_create(
                project_id,
                ImageGenerationTaskCreateIn(
                    kind="image",
                    model_id=model_id,
                    prompt="数量校验",
                    size="1024x1024",
                    reference_asset_ids=asset_ids,
                ),
            )
        await session.rollback()
        # Test database only; project deletion cascades all rows produced here.
        from sqlalchemy import delete

        await session.execute(
            delete(VisualWorkshopProject).where(VisualWorkshopProject.id == project_id)
        )
        await session.execute(delete(ModelProvider).where(ModelProvider.id == provider_id))
        await session.commit()


@pytest.mark.asyncio
async def test_ark_empty_address_uses_official_default():
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(200, json={"data": [{"url": "https://media.example/output.png"}]})

    result = await generate_image(
        base_url="",
        api_key="test",
        model=SEEDREAM_MODEL,
        payload={"prompt": "人物", "size": "2048x2048"},
        references=[],
        transport=httpx.MockTransport(respond),
    )
    assert str(requests[0].url) == "https://ark.cn-beijing.volces.com/api/v3/images/generations"
    assert result == "https://media.example/output.png"
