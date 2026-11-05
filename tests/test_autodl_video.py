"""Deterministic wire, policy and entry-point coverage for the twelve pinned workflows."""

import json
from dataclasses import replace
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from pydantic import ValidationError
from tests.credential_test_support import encrypt_secret
from tests.test_generation_task_driver import FakeStore, _driver, _task

from studio.apps.model_service.inference.catalog import normalize_parameters
from studio.apps.model_service.playground.generation import ModelTestGeneration
from studio.apps.model_service.providers._senseaudio import ProviderTaskStatus
from studio.apps.model_service.providers.autodl_video import create_task, get_task
from studio.apps.model_service.providers.autodl_workflows import (
    MOTION,
    PREFIX,
    WORKFLOWS,
    capabilities,
    normalize_request,
    prepare_payload,
    validate_references,
)
from studio.apps.model_service.storage.models.model_service import ModelEntry, ModelProvider
from studio.apps.visual_workshop.schemas.workshop import VisualCanvasVideoGenerationDraft
from studio.apps.visual_workshop.storage.models import VisualWorkshopProject
from studio.apps.visual_workshop.website.generation import VisualGeneration
from studio.assembly.website.models import bind_owner
from studio.config.settings import get_settings
from studio.config.settings import get_settings as isolated_settings
from studio.contracts.model_service.generation_tasks import VideoGenerationTaskCreateIn
from studio.contracts.model_service.schemas.model_inference import InferenceTaskIn
from studio.contracts.model_service.schemas.model_service import ProviderIn
from studio.contracts.model_service.schemas.model_test import ModelTestVideoGenerationIn
from studio.runtime.secrets import SecretCipher
from website_test_support import SessionLocal


def request(model):
    spec = WORKFLOWS[model]
    payload = {
        "prompt": "subject walks" if spec.prompt else "",
        "mode": spec.mode,
        "duration": 5,
        "reference_asset_ids": [f"image-{i}" for i in range(spec.images_min)],
        "audio_asset_ids": [f"audio-{i}" for i in range(spec.audio_min)],
        "video_asset_ids": ["video-0"] if model == MOTION else [],
    }
    if spec.mode == "frames":
        payload.update(
            reference_asset_ids=[], first_frame_asset_id="first", last_frame_asset_id="last"
        )
    return payload


def content(payload):
    result = []
    for key in ("first_frame", "last_frame"):
        if payload.get(key + "_asset_id"):
            result.append({"type": "image", "role": key, "url": key})
    for kind, field in (
        ("image", "reference_asset_ids"),
        ("audio", "audio_asset_ids"),
        ("video", "video_asset_ids"),
    ):
        result.extend(
            {"type": kind, "url" if kind == "image" else f"{kind}_url": identity}
            for identity in payload[field]
        )
    return result


@pytest.mark.parametrize("model", list(WORKFLOWS))
@pytest.mark.asyncio
async def test_each_workflow_submits_its_exact_pinned_contract(model):
    payload = normalize_request(model, request(model))
    before = json.dumps(payload)
    wire = prepare_payload(model, payload, content(payload))
    seen = []

    def handle(req):
        seen.append(req)
        assert req.headers["Authorization"] == "raw-token"
        assert req.url.path.endswith("/" + model)
        assert json.loads(req.content) == wire
        return httpx.Response(200, json={"code": "Success", "data": {"task_id": "upstream"}})

    assert (
        await create_task(
            base_url="",
            api_key="raw-token",
            model=model,
            payload=payload,
            content=content(payload),
            transport=httpx.MockTransport(handle),
        )
        == "upstream"
    )
    assert len(seen) == 1 and json.dumps(payload) == before
    assert wire["resolution"] == ("464*832px(竖版)" if model == MOTION else "768p竖")
    assert ("seed" in wire) == (WORKFLOWS[model].seed_min is not None)
    assert ("prompt" in wire) == WORKFLOWS[model].prompt
    if model == MOTION:
        assert set(wire) == {"resolution", "seed", "ref_image", "ref_video"}
    elif model == PREFIX + "image_audio_to_video":
        assert set(wire) == {"resolution", "audio_duration", "ref_image_0", "ref_audio_0"}
    elif model == PREFIX + "lightx2v":
        assert wire["first_frame"] == "first_frame" and wire["last_frame"] == "last_frame"
        assert "ref_image_0" not in wire


@pytest.mark.parametrize("model", list(WORKFLOWS))
def test_boundaries_defaults_seed_snapshot_and_mime(model):
    payload = request(model)
    normalized = normalize_request(model, payload)
    assert normalize_request(model, normalized) == normalized
    if model != MOTION:
        for duration in (0, WORKFLOWS[model].duration_max + 1, -1):
            with pytest.raises(ValueError, match="时长"):
                normalize_request(model, {**payload, "duration": duration})
    if WORKFLOWS[model].prompt:
        normalize_request(model, {**payload, "prompt": "a" * 20000})
        with pytest.raises(ValueError):
            normalize_request(model, {**payload, "prompt": "a" * 20001})
    if WORKFLOWS[model].seed_min is not None:
        for seed in (WORKFLOWS[model].seed_min - 1, 10**15, 1.5, True):
            with pytest.raises(ValueError, match="种子"):
                normalize_request(model, {**payload, "workflow_parameters": {"seed": seed}})
    else:
        with pytest.raises(ValueError, match="参数"):
            normalize_request(model, {**payload, "workflow_parameters": {"seed": 1}})
    with pytest.raises(ValueError, match="数量|需要"):
        normalize_request(model, {**payload, "audio_asset_ids": [str(i) for i in range(4)]})
    with pytest.raises(ValueError, match="格式"):
        validate_references(model, [("image", "image/gif", 1)])
    with pytest.raises(ValueError, match="45 MB"):
        validate_references(model, [("image", "image/png", 46 * 1024 * 1024)])


def test_resolution_pairs_order_and_audio_only_capabilities():
    for suffix in ("zm_nono", "zm_u30"):
        with pytest.raises(ValueError, match="尺寸"):
            normalize_request(
                PREFIX + suffix, {**request(PREFIX + suffix), "resolution": "960p", "ratio": "16:9"}
            )
    model = PREFIX + "zm_u24"
    payload = {
        **request(model),
        "reference_asset_ids": ["B", "A"],
        "audio_asset_ids": ["Y", "X"],
        "ratio": "1:1",
        "resolution": "480p",
    }
    wire = prepare_payload(model, normalize_request(model, payload), content(payload))
    assert wire["resolution"] == "480p(1:1)"
    assert [wire["ref_image_0"], wire["ref_image_1"], wire["ref_audio_0"], wire["ref_audio_1"]] == [
        "B",
        "A",
        "Y",
        "X",
    ]
    for suffix in ("image_audio_to_video_v2", "image_audio_to_video_v2_15s"):
        model = PREFIX + suffix
        assert capabilities(model).audio_only
        normalize_request(model, {**request(model), "audio_asset_ids": ["voice"]})
        normalize_request(model, {**request(model), "mode": "text"})
        validate_references(model, [("audio", "audio/flac", 10)])
    with pytest.raises(ValueError):
        validate_references(PREFIX + "zm_nono", [("audio", "audio/flac", 10)])
    validate_references(MOTION, [("video", "video/webm", 10)])


@pytest.mark.parametrize(
    "remote,expected",
    [
        ("QUEUED", "pending"),
        ("RUNNING", "processing"),
        ("SUCCESS", "completed"),
        ("completed", "completed"),
        ("FAILED", "failed"),
        ("cancelled", "failed"),
    ],
)
@pytest.mark.asyncio
async def test_status_normalization(remote, expected):
    data = {"status": remote, "results": [{"type": "video", "url": "https://cdn.example/out.mp4"}]}
    result = await get_task(
        base_url="",
        api_key="raw-token",
        task_id="remote",
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, json={"code": "Success", "data": data})
        ),
    )
    assert result.status == expected


@pytest.mark.asyncio
async def test_business_http_errors_do_not_retry_and_redact_raw_authorization():
    sent = []

    def fail(req):
        sent.append(req)
        return httpx.Response(429, json={"code": "Failure", "msg": "raw-secret rejected"})

    model = PREFIX + "lightx2v_no_pic"
    with pytest.raises(ValueError, match="REDACTED") as error:
        await create_task(
            base_url="",
            api_key="raw-secret",
            model=model,
            payload=normalize_request(model, request(model)),
            content=[],
            transport=httpx.MockTransport(fail),
        )
    assert "raw-secret" not in str(error.value) and len(sent) == 1
    with pytest.raises(ValueError, match="视频地址"):
        await get_task(
            base_url="",
            api_key="test",
            task_id="task",
            transport=httpx.MockTransport(
                lambda _: httpx.Response(
                    200, json={"code": "Success", "data": {"status": "SUCCESS", "results": []}}
                )
            ),
        )


def test_canvas_long_prompt_versions_roundtrip_and_existing_draft_limits():
    draft = VisualCanvasVideoGenerationDraft(prompt="x" * 20000, resolution="960p")
    assert (
        VisualCanvasVideoGenerationDraft.model_validate(draft.model_dump())
        .prompt_versions[0]
        .prompt
        == "x" * 20000
    )
    from studio.apps.visual_workshop.schemas.workshop import VisualCanvasImageGenerationDraft

    with pytest.raises(ValidationError):
        VisualCanvasImageGenerationDraft(prompt="x" * 6001)


@pytest.mark.parametrize("model_slug", list(WORKFLOWS))
@pytest.mark.asyncio
async def test_options_and_all_admission_paths_share_the_contract(model_slug):
    from sqlalchemy import delete

    from studio.apps.asset_library.storage.file_paths import AssetStorage
    from studio.apps.asset_library.storage.models import VisualAsset
    from studio.apps.model_service.storage.models.model_test import (
        ModelTestGenerationAsset,
        ModelTestGenerationTask,
    )
    from studio.apps.visual_workshop.storage.models import VisualGenerationTask
    from studio.config.settings import get_settings

    async with SessionLocal() as session:
        bind_owner(session, "test-user")
        provider = ModelProvider(
            owner_user_id="test-user",
            id=str(uuid4()),
            name="AutoDL fixture",
            kind="autodl_video",
            base_url="https://www.autodl.art",
            api_key_ciphertext=encrypt_secret("test-token"),
        )
        project = VisualWorkshopProject(
            owner_user_id="test-user", id=str(uuid4()), title="AutoDL", kind="video"
        )
        session.add_all([provider, project])
        await session.flush()
        model = ModelEntry(
            owner_user_id="test-user",
            id=str(uuid4()),
            provider_id=provider.id,
            slug=model_slug,
            label="AutoDL fixture",
            capabilities=["video_generation"],
        )
        session.add(model)
        await session.flush()
        body = request(model_slug)
        if not any(
            body.get(k)
            for k in (
                "reference_asset_ids",
                "audio_asset_ids",
                "video_asset_ids",
                "first_frame_asset_id",
            )
        ):
            body["mode"] = "text"
        body.update(kind="video", model_id=model.id)
        if WORKFLOWS[model_slug].prompt:
            body["prompt"] = "x" * 20000
        storage = AssetStorage(get_settings())
        private_body, inference_body = dict(body), dict(body)
        inference_assets = []
        for field, kind in (
            ("reference_asset_ids", "image"),
            ("first_frame_asset_id", "image"),
            ("last_frame_asset_id", "image"),
            ("audio_asset_ids", "audio"),
            ("video_asset_ids", "video"),
        ):
            supplied = body.get(field) or []
            if field.endswith("asset_id") and not supplied:
                continue
            identities = [supplied] if isinstance(supplied, str) else supplied
            visual_ids, private_ids, inference_ids = [], [], []
            for identity in identities:
                mime = {"image": "image/png", "audio": "audio/flac", "video": "video/webm"}[kind]
                asset = VisualAsset(
                    owner_user_id="test-user",
                    id=str(uuid4()),
                    project_id=project.id,
                    media_kind=kind,
                    original_filename=identity,
                    display_name=identity,
                    mime_type=mime,
                    byte_size=4,
                    storage_key=uuid4().hex,
                )
                session.add(asset)
                await session.flush()
                path = storage.path_for(asset)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"data")
                visual_ids.append(asset.id)
                private = ModelTestGenerationAsset(
                    owner_user_id="test-user",
                    id=str(uuid4()),
                    original_filename=identity,
                    storage_key=uuid4().hex,
                    media_kind=kind,
                    mime_type=mime,
                    byte_size=4,
                )
                session.add(private)
                root = get_settings().account_model_test_path("test-user", "references")
                root.mkdir(parents=True, exist_ok=True)
                (root / private.storage_key).write_bytes(b"data")
                private_ids.append(private.id)
                inference_ids.append(private.id)
                inference_assets.append(
                    SimpleNamespace(id=private.id, media_kind=kind, mime_type=mime, byte_size=4)
                )
            if isinstance(supplied, str):
                body[field], private_body[field], inference_body[field] = (
                    visual_ids[0],
                    private_ids[0],
                    inference_ids[0],
                )
            else:
                body[field], private_body[field], inference_body[field] = (
                    visual_ids,
                    private_ids,
                    inference_ids,
                )
        await session.commit()
        visual = VisualGeneration(session)
        test = ModelTestGeneration(session, "test-user", settings=get_settings())
        for option in ((await visual.options()).models, (await test.options()).items):
            selected = next(item for item in option if item.id == model.id)
            assert selected.video_capabilities.duration_min == 1
        task = await visual.prepare_create(project.id, VideoGenerationTaskCreateIn(**body))
        expected_resolution = "464x832" if model_slug == MOTION else "768p"
        assert task.request_payload["resolution"] == expected_resolution
        await session.commit()
        test_task = await test.create(ModelTestVideoGenerationIn(**private_body))
        assert test_task.provider_kind == "autodl_video"
        parameters = {k: v for k, v in inference_body.items() if k not in {"kind", "model_id"}}
        normalized = normalize_parameters(
            InferenceTaskIn(
                request_id="test",
                model_id=model.id,
                kind="video",
                parameters=parameters,
                asset_ids=[a.id for a in inference_assets],
            ),
            model,
            provider,
            inference_assets,
        )
        assert normalized["resolution"] == expected_resolution
        assert ("seed" in normalized["workflow_parameters"]) == (
            WORKFLOWS[model_slug].seed_min is not None
        )
        assert (
            ProviderIn(kind="autodl_video", name="AutoDL", expected_catalog_revision=0).base_url
            == "https://www.autodl.art"
        )
        await session.execute(
            delete(ModelTestGenerationTask).where(ModelTestGenerationTask.id == test_task.id)
        )
        await session.execute(
            delete(VisualGenerationTask).where(VisualGenerationTask.project_id == project.id)
        )
        await session.execute(
            delete(VisualWorkshopProject).where(VisualWorkshopProject.id == project.id)
        )
        await session.execute(delete(ModelProvider).where(ModelProvider.id == provider.id))
        await session.commit()


@pytest.mark.asyncio
async def test_every_runner_inlines_motion_video_and_audio_without_temporary_upload(monkeypatch):
    from studio.apps.model_service.generation import visual_submission as visual_submission
    from studio.apps.model_service.inference import runner as inference_module
    from studio.apps.model_service.playground import generation_runner as test_module
    from studio.apps.visual_workshop.website import generation_runner as visual_module

    captured = []

    async def submit(**kwargs):
        captured.append(kwargs["video_content"])
        return "remote"

    async def inline(*_args, **_kwargs):
        return "data:video/webm;base64,AA=="

    async def forbidden(*_args, **_kwargs):
        raise AssertionError("AutoDL must not upload to temporary hosting")

    for module in (visual_submission, inference_module, test_module):
        monkeypatch.setattr(module, "submit_generation_task", submit)
    visual, test, inference = (
        visual_module.VisualGenerationRunner(
            session_factory=SessionLocal,
            settings=get_settings(),
            decrypt=SecretCipher(isolated_settings().fpl_secrets_key).decrypt,
        ),
        test_module.ModelTestGenerationRunner(
            SessionLocal,
            decrypt=SecretCipher(isolated_settings().fpl_secrets_key).decrypt,
            settings=isolated_settings(),
        ),
        inference_module.InferenceRunner(
            SessionLocal,
            decrypt=SecretCipher(isolated_settings().fpl_secrets_key).decrypt,
            settings=isolated_settings(),
        ),
    )
    for runner in (visual, test):
        monkeypatch.setattr(runner, "_asset_data_uri", inline)
        monkeypatch.setattr(runner, "_temporary_asset_url", forbidden)
    monkeypatch.setattr(inference_module, "read_data_uri", inline)

    async def inputs(_task):
        return {"video": (None, "video/webm", "clip.webm", 4)}

    monkeypatch.setattr(inference, "inputs", inputs)
    task = replace(
        _task("queued", provider_kind="autodl_video"),
        model_slug=MOTION,
        payload={"mode": "reference", "video_asset_ids": ["video"]},
    )
    await visual._submit_context(task)
    await test._submit_context(task)
    await inference.submit(task)
    assert len(captured) == 3
    assert all(
        next(item for item in items if item["type"] == "video")["video_url"].startswith("data:")
        for items in captured
    )


@pytest.mark.asyncio
async def test_recovery_never_resubmits_and_existing_result_only_retries_download():
    store = FakeStore(_task("pending", provider_kind="autodl_video"))
    saves = []

    async def submit(_context):
        raise AssertionError("never resubmit")

    async def poll(_context):
        return ProviderTaskStatus("completed", result_url="https://cdn.example/out.mp4")

    async def materialize(_identity, url):
        saves.append(url)
        store.task = replace(store.task, status="completed")

    driver = _driver(store, submit=submit, poll=poll, materialize=materialize)
    await driver.recover()
    await driver.process("task-1")
    store.task = _task("processing", provider_kind="autodl_video", result_url=saves[0])
    await driver.process("task-1")
    assert len(saves) == 2
    store.task = _task("submitting", provider_kind="autodl_video")
    await driver.recover()
    await driver.process("task-1")
    assert store.task.status == "failed"


@pytest.mark.asyncio
async def test_canvas_frame_links_preserve_roles_order_snapshot_and_cas():
    from studio.apps.visual_workshop.outputs.history import OutputError
    from studio.apps.visual_workshop.outputs.references import resolve_references
    from studio.apps.visual_workshop.storage.models import VisualCanvasDocument

    canvas = SimpleNamespace(
        revision=3,
        nodes=[
            {"id": "a", "kind": "image", "title": "first", "asset_id": "image-a"},
            {"id": "b", "kind": "image", "title": "last", "asset_id": "image-b"},
            {"id": "target", "kind": "video", "title": "target"},
        ],
        edges=[
            {
                "id": "edge-a",
                "source_node_id": "a",
                "target_node_id": "target",
                "purpose": "reference",
            },
            {
                "id": "edge-b",
                "source_node_id": "b",
                "target_node_id": "target",
                "purpose": "reference",
            },
        ],
    )

    class Session:
        async def get(self, shape, _identity):
            assert shape is VisualCanvasDocument
            return canvas

    body = VideoGenerationTaskCreateIn(
        kind="video",
        model_id="model",
        prompt="frames",
        mode="frames",
        first_frame_asset_id="image-a",
        last_frame_asset_id="image-b",
        canvas_node_id="target",
        expected_canvas_revision=3,
    )
    resolved, titles, snapshot = await resolve_references(
        Session(), "project", body, frame_reference_slots=True
    )
    assert resolved.reference_asset_ids == []
    assert resolved.first_frame_asset_id == "image-a" and resolved.last_frame_asset_id == "image-b"
    assert titles == {"image-a": "first", "image-b": "last"}
    assert [item["asset_id"] for item in snapshot] == ["image-a", "image-b"]
    with pytest.raises(OutputError, match="刷新"):
        await resolve_references(
            Session(),
            "project",
            body.model_copy(update={"expected_canvas_revision": 2}),
            frame_reference_slots=True,
        )
