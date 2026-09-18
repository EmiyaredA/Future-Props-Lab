from __future__ import annotations

import asyncio
import socket
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete

from app.capabilities.asset_store.storage import AssetStorage
from app.llm.providers.temporary_media import TemporaryMediaError
from app.apps.visual_workshop.models import (
    VisualGenerationTask,
    VisualWorkshopProject,
)
from app.llm.models import (
    ModelEntry,
    ModelProvider,
)
from app.models import (
    VisualAsset,
)
from app.runtime.config import get_settings
from app.runtime.credentials import encrypt_secret
from app.runtime.db import SessionLocal
from app.apps.visual_workshop.generation_runner import (
    MaterializationError,
    VisualGenerationRunner,
    _assert_public_https,
    _generated_type,
    _safe_task_error,
)


def _task(
    *,
    project_id: str,
    provider_id: str,
    model_id: str,
    status: str,
    result_url: str | None = None,
) -> VisualGenerationTask:
    return VisualGenerationTask(
        project_id=project_id,
        provider_id=provider_id,
        model_id=model_id,
        provider_kind="senseaudio_image",
        generation_kind="image",
        provider_name="SenseAudio 图片生成",
        model_slug="senseaudio-image-2.0-260319",
        request_payload={
            "kind": "image",
            "model_id": model_id,
            "prompt": "test",
            "size": "1024x1024",
            "seed": None,
            "reference_asset_id": None,
        },
        status=status,
        result_url=result_url,
    )


async def _fixture_rows() -> tuple[VisualWorkshopProject, ModelProvider, ModelEntry]:
    project = VisualWorkshopProject(id=str(uuid4()), title="生成测试", kind="image")
    provider = ModelProvider(
        id=str(uuid4()),
        name="SenseAudio Runner Test",
        kind="senseaudio_image",
        base_url="https://api.senseaudio.cn/v1",
        api_key_ciphertext=encrypt_secret("runner-test-secret"),
        enabled=True,
        sort_order=99,
    )
    model = ModelEntry(
        id=str(uuid4()),
        provider_id=provider.id,
        slug="senseaudio-image-2.0-260319",
        label="Runner Test",
        description="",
        capabilities=["image_generation"],
        enabled=True,
        sort_order=0,
    )
    async with SessionLocal() as session:
        session.add_all([project, provider])
        await session.commit()
    async with SessionLocal() as session:
        session.add(model)
        await session.commit()
    return project, provider, model


async def _cleanup(provider_id: str, project_id: str) -> None:
    async with SessionLocal() as session:
        assets = (
            (
                await session.execute(
                    VisualAsset.__table__.select().where(VisualAsset.project_id == project_id)
                )
            )
            .mappings()
            .all()
        )
        await session.execute(
            delete(VisualGenerationTask).where(VisualGenerationTask.provider_id == provider_id)
        )
        await session.execute(delete(VisualAsset).where(VisualAsset.project_id == project_id))
        await session.execute(
            delete(VisualWorkshopProject).where(VisualWorkshopProject.id == project_id)
        )
        await session.execute(delete(ModelProvider).where(ModelProvider.id == provider_id))
        await session.commit()
    for asset in assets:
        path = AssetStorage(get_settings()).target_path(
            str(asset["storage_key"]),
            visual_project_id=project_id,
            galgame_project_id=None,
            workspace_id=str(asset["workspace_id"]),
        )
        path.unlink(missing_ok=True)


def test_generated_type_requires_matching_mime_and_signature() -> None:
    png = b"\x89PNG\r\n\x1a\n" + b"data"
    assert _generated_type(png, "image/png") == ("image", "image/png", ".png")
    assert _generated_type(png, "text/plain") is None
    assert _generated_type(b"not-an-image", "image/png") is None


def test_temporary_upload_error_is_sanitized() -> None:
    error = TemporaryMediaError("https://temp.sh/private-result.mp4")
    assert _safe_task_error(error) == "参考素材临时上传失败，请重新生成"


@pytest.mark.asyncio
async def test_video_submit_materializes_asset_ids_and_keeps_legacy_urls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    submitted: dict = {}
    temporary_calls: list[tuple[str, str, str | None]] = []

    async def fake_create(**kwargs) -> str:
        submitted.update(kwargs)
        return "provider-task"

    async def fake_image(asset_id: str, _workspace_id: str) -> str:
        return f"data:image/png;base64,{asset_id}"

    async def fake_temporary(
        asset_id: str, kind: str, _workspace_id: str, filename: str | None = None
    ) -> str:
        temporary_calls.append((asset_id, kind, filename))
        return f"https://temp.sh/{kind}-{asset_id}"

    runner = VisualGenerationRunner()
    monkeypatch.setattr("app.apps.visual_workshop.generation_runner.submit_generation_task", fake_create)
    monkeypatch.setattr(runner, "_asset_data_uri", fake_image)
    monkeypatch.setattr(runner, "_temporary_asset_url", fake_temporary)

    await runner._submit(
        provider_kind="senseaudio_video",
        base_url="https://api.example/v1",
        api_key="secret",
        model_slug="video-model",
        workspace_id="default",
        payload={
            "prompt": "参考运镜",
            "mode": "reference",
            "reference_asset_ids": ["image-1"],
            "audio_asset_ids": ["audio-1"],
            "video_asset_ids": ["video-1"],
            "reference_filenames": {
                "audio-1": "环境声.mp3",
                "video-1": "开局.mp4",
            },
            "audio_urls": ["https://legacy.example/audio.mp3"],
            "video_urls": ["https://legacy.example/video.mp4"],
            "duration": 5,
            "resolution": "720p",
            "ratio": "16:9",
            "watermark": True,
            "generate_audio": False,
        },
    )

    assert submitted["video_content"] == [
        {"type": "text", "text": "参考运镜"},
        {
            "type": "image",
            "url": "data:image/png;base64,image-1",
            "role": "reference",
        },
        {"type": "audio", "audio_url": "https://temp.sh/audio-audio-1"},
        {"type": "video", "video_url": "https://temp.sh/video-video-1"},
        {"type": "audio", "audio_url": "https://legacy.example/audio.mp3"},
        {"type": "video", "video_url": "https://legacy.example/video.mp4"},
    ]
    assert temporary_calls == [
        ("audio-1", "audio", "环境声.mp3"),
        ("video-1", "video", "开局.mp4"),
    ]


@pytest.mark.asyncio
async def test_temporary_upload_failure_happens_before_provider_submission(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider_called = False

    async def fake_create(**_kwargs) -> str:
        nonlocal provider_called
        provider_called = True
        return "provider-task"

    async def failed_upload(
        _asset_id: str,
        _kind: str,
        _workspace_id: str,
        _filename: str | None = None,
    ) -> str:
        raise TemporaryMediaError("private upstream response")

    runner = VisualGenerationRunner()
    monkeypatch.setattr("app.apps.visual_workshop.generation_runner.submit_generation_task", fake_create)
    monkeypatch.setattr(runner, "_temporary_asset_url", failed_upload)

    with pytest.raises(TemporaryMediaError):
        await runner._submit(
            provider_kind="senseaudio_video",
            base_url="https://api.example/v1",
            api_key="secret",
            model_slug="video-model",
            workspace_id="default",
            payload={
                "prompt": "参考运镜",
                "mode": "reference",
                "reference_asset_ids": [],
                "audio_asset_ids": [],
                "video_asset_ids": ["video-1"],
                "duration": 5,
                "resolution": "720p",
                "ratio": "16:9",
                "watermark": True,
                "generate_audio": False,
            },
        )

    assert provider_called is False


@pytest.mark.asyncio
async def test_result_url_rejects_private_and_authenticated_hosts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *_args, **_kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))],
    )
    with pytest.raises(MaterializationError, match="非公网"):
        await _assert_public_https("https://cdn.example/result.png")
    with pytest.raises(MaterializationError, match="无凭证"):
        await _assert_public_https("https://user:password@cdn.example/result.png")


@pytest.mark.asyncio
async def test_download_rejects_declared_size_and_mime(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *_args, **_kwargs: [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))
        ],
    )

    async def too_large(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=b"\x89PNG\r\n\x1a\n0123456789",
            headers={"content-type": "image/png", "content-length": "100"},
        )

    small_settings = get_settings().model_copy(update={"fpl_visual_asset_max_bytes": 20})
    runner = VisualGenerationRunner(
        settings=small_settings,
        download_transport=httpx.MockTransport(too_large),
    )
    with pytest.raises(MaterializationError, match="文件大小"):
        await runner._download("https://cdn.example/result.png", tmp_path / "large")

    async def wrong_mime(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=b"\x89PNG\r\n\x1a\nvalid",
            headers={"content-type": "text/plain"},
        )

    runner = VisualGenerationRunner(download_transport=httpx.MockTransport(wrong_mime))
    with pytest.raises(MaterializationError, match="受支持"):
        await runner._download("https://cdn.example/result.png", tmp_path / "mime")


@pytest.mark.asyncio
async def test_runner_recovery_and_concurrency_limit() -> None:
    project, provider, model = await _fixture_rows()
    try:
        rows = [
            _task(
                project_id=project.id,
                provider_id=provider.id,
                model_id=model.id,
                status="submitting" if index == 0 else "queued",
            )
            for index in range(9)
        ]
        async with SessionLocal() as session:
            session.add_all(rows)
            await session.commit()

        runner = VisualGenerationRunner()
        await runner.recover()
        async with SessionLocal() as session:
            interrupted = await session.get(VisualGenerationTask, rows[0].id)
            assert interrupted is not None
            assert interrupted.status == "failed"
            assert "避免重复计费" in interrupted.error_message

        active = 0
        maximum = 0

        async def fake_process(_task_id: str) -> None:
            nonlocal active, maximum
            active += 1
            maximum = max(maximum, active)
            await asyncio.sleep(0.01)
            active -= 1

        runner._process_task = fake_process  # type: ignore[method-assign]
        await runner.process_once()
        assert maximum == 4
    finally:
        await _cleanup(provider.id, project.id)


@pytest.mark.asyncio
async def test_concurrent_claim_submits_a_queued_task_only_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project, provider, model = await _fixture_rows()
    task = _task(
        project_id=project.id,
        provider_id=provider.id,
        model_id=model.id,
        status="queued",
    )
    submissions = 0
    try:
        async with SessionLocal() as session:
            session.add(task)
            await session.commit()

        async def fake_submit(**_kwargs) -> str:
            nonlocal submissions
            submissions += 1
            await asyncio.sleep(0.01)
            return "provider-task-once"

        monkeypatch.setattr(
            "app.apps.visual_workshop.generation_runner.submit_generation_task", fake_submit
        )
        runner = VisualGenerationRunner()
        await asyncio.gather(runner._process_task(task.id), runner._process_task(task.id))

        async with SessionLocal() as session:
            current = await session.get(VisualGenerationTask, task.id)
            assert current is not None
            assert current.status == "pending", current.error_message
            assert current.provider_task_id == "provider-task-once"
        assert submissions == 1
    finally:
        await _cleanup(provider.id, project.id)


@pytest.mark.asyncio
async def test_processing_result_completes_only_after_asset_is_saved(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project, provider, model = await _fixture_rows()
    task = _task(
        project_id=project.id,
        provider_id=provider.id,
        model_id=model.id,
        status="processing",
        result_url="https://cdn.example/result.png",
    )
    try:
        async with SessionLocal() as session:
            session.add(task)
            await session.commit()

        async def fake_download(_url: str, target: Path) -> tuple[int, str, str, str]:
            payload = b"\x89PNG\r\n\x1a\nmaterialized"
            target.write_bytes(payload)
            return len(payload), "image", "image/png", ".png"

        runner = VisualGenerationRunner()
        monkeypatch.setattr(runner, "_download", fake_download)
        await runner.process_once()

        async with SessionLocal() as session:
            completed = await session.get(VisualGenerationTask, task.id)
            assert completed is not None
            assert completed.status == "completed"
            assert completed.result_asset_id is not None
            asset = await session.get(VisualAsset, completed.result_asset_id)
            assert asset is not None
            assert asset.project_id == project.id
            assert AssetStorage(get_settings()).path_for(asset).is_file()
    finally:
        await _cleanup(provider.id, project.id)
