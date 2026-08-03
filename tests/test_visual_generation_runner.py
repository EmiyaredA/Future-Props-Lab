from __future__ import annotations

import asyncio
import socket
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.models import (
    ModelEntry,
    ModelProvider,
    VisualAsset,
    VisualGenerationTask,
    VisualWorkshopProject,
)
from app.visual_workshop.generation_runner import (
    MaterializationError,
    VisualGenerationRunner,
    _assert_public_https,
    _generated_type,
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
        api_key_ciphertext="",
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
        (get_settings().visual_asset_path / asset["storage_key"]).unlink(missing_ok=True)


def test_generated_type_requires_matching_mime_and_signature() -> None:
    png = b"\x89PNG\r\n\x1a\n" + b"data"
    assert _generated_type(png, "image/png") == ("image", "image/png", ".png")
    assert _generated_type(png, "text/plain") is None
    assert _generated_type(b"not-an-image", "image/png") is None


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
            assert (get_settings().visual_asset_path / asset.storage_key).is_file()
    finally:
        await _cleanup(provider.id, project.id)
