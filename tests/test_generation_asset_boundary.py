"""Generation files remain Models-owned and survive uncertain database acknowledgements."""

import asyncio
import io
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from studio.apps.model_service.playground.generation_assets import (
    GenerationAssetError,
    ModelTestGenerationAssets,
)
from studio.apps.model_service.playground.generation_runner import ModelTestGenerationRunner
from studio.apps.model_service.storage.migrations.registry import MIGRATIONS
from studio.apps.model_service.storage.models.model_test import (
    ModelTestGenerationAsset,
    ModelTestGenerationTask,
)
from studio.apps.model_service.storage.service_models import ACCOUNT_MODELS, MODELS
from studio.runtime.database.migrations import apply
from studio.runtime.database.sessions import Database


@pytest.fixture
async def instance(tmp_path):
    apply(tmp_path / "service.db", "models", MIGRATIONS)
    database = Database("models", tmp_path, models=MODELS, account_models=ACCOUNT_MODELS)
    settings = SimpleNamespace(
        runtime_path=tmp_path,
        fpl_visual_asset_max_bytes=1_000_000,
        account_model_test_path=lambda owner, kind: (
            tmp_path / "accounts" / owner / "model-test" / kind
        ),
    )
    try:
        yield database, settings
    finally:
        await database.close()


class Incoming:
    filename, content_type = "参考.mp4", "video/mp4"

    def __init__(self, *, cancel=False):
        self.source, self.cancel = io.BytesIO(b"\x00\x00\x00\x18ftypisom"), cancel

    async def read(self, size=-1):
        if self.cancel:
            raise asyncio.CancelledError
        return self.source.read(size)

    async def close(self):
        self.source.close()


async def test_generation_upload_lost_commit_ack_keeps_owned_reference(instance, monkeypatch):
    database, settings = instance
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        original = session.commit

        async def lost_acknowledgement():
            await original()
            raise RuntimeError("synthetic lost acknowledgement")

        monkeypatch.setattr(session, "commit", lost_acknowledgement)
        with pytest.raises(RuntimeError, match="lost acknowledgement"):
            await ModelTestGenerationAssets(session, "alpha", settings).upload([Incoming()])
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        rows = list(await session.scalars(select(ModelTestGenerationAsset)))
        assert len(rows) == 1
        path = settings.account_model_test_path("alpha", "references") / rows[0].storage_key
        assert path.read_bytes() == b"\x00\x00\x00\x18ftypisom"


async def test_cancellation_before_generation_upload_commit_removes_only_staged_file(instance):
    database, settings = instance
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        with pytest.raises(asyncio.CancelledError):
            await ModelTestGenerationAssets(session, "alpha", settings).upload(
                [Incoming(cancel=True)]
            )
        assert list(await session.scalars(select(ModelTestGenerationAsset))) == []
    assert not any(p.is_file() for p in settings.runtime_path.joinpath("accounts").rglob("*"))


async def test_unmigrated_legacy_reference_requires_an_explicit_recovery_adapter(instance):
    database, settings = instance
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        task = ModelTestGenerationTask(
            owner_user_id="alpha",
            provider_kind="senseaudio_video",
            generation_kind="video",
            provider_name="fixture",
            model_slug="fixture",
            status="failed",
            request_payload={"video_asset_ids": ["legacy-library-id"]},
        )
        session.add(task)
        await session.commit()
        task_id = task.id
        with pytest.raises(GenerationAssetError) as missing:
            await ModelTestGenerationAssets(session, "alpha", settings).backfill_status()
        assert missing.value.status == 503
    runner = ModelTestGenerationRunner(database.sessions, settings)
    try:
        with pytest.raises(ValueError, match="尚未转移"):
            await runner._asset_path(task_id, "legacy-library-id", "video")
    finally:
        await runner.stop()


async def test_generation_materialization_lost_ack_keeps_completed_result(instance, monkeypatch):
    database, settings = instance
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        task = ModelTestGenerationTask(
            owner_user_id="alpha",
            provider_kind="senseaudio_image",
            generation_kind="image",
            provider_name="fixture",
            model_slug="fixture",
            status="processing",
            request_payload={},
            result_url="https://provider.invalid/result.png",
        )
        session.add(task)
        await session.commit()
        task_id = task.id

    def sessions(**kwargs):
        session = database.sessions(**kwargs)
        original = session.commit

        async def lost_acknowledgement():
            await original()
            raise RuntimeError("synthetic lost acknowledgement")

        monkeypatch.setattr(session, "commit", lost_acknowledgement)
        return session

    runner = ModelTestGenerationRunner(sessions, settings)

    async def download(_url, target):
        target.write_bytes(b"synthetic-result")
        return 16, "image", "image/png", ".png"

    monkeypatch.setattr(runner, "_download", download)
    try:
        await runner._materialize(task_id, "https://provider.invalid/result.png")
        async with database.sessions(info={"owner_user_id": "alpha"}) as session:
            row = await session.get(ModelTestGenerationTask, task_id)
            assert row.status == "completed"
            path = settings.account_model_test_path("alpha", "generated") / row.result_storage_key
            assert path.read_bytes() == b"synthetic-result"
    finally:
        await runner.stop()


async def test_backfill_cancellation_waits_for_copy_before_cleaning_staged_file(
    instance, monkeypatch
):
    import threading

    from studio.apps.model_service.playground import generation_assets
    from studio.apps.model_service.playground.generation_assets import (
        ROLE_FIELDS,
        LegacyAssetSource,
    )

    database, settings = instance
    source = settings.runtime_path / "original-reference.mp4"
    source.write_bytes(b"\x00\x00\x00\x18ftypisom")
    started, finish = threading.Event(), threading.Event()
    original_copy = generation_assets.shutil.copyfile

    def paused_copy(origin, target):
        started.set()
        assert finish.wait(timeout=3)
        return original_copy(origin, target)

    monkeypatch.setattr(generation_assets.shutil, "copyfile", paused_copy)

    class References:
        async def assets(self, _session, _task):
            return {
                field: [
                    LegacyAssetSource(
                        "old", "original.mp4", "video", "video/mp4", source.stat().st_size, source
                    )
                ]
                if field == "video_asset_ids"
                else []
                for field, _role, _kind in ROLE_FIELDS
            }

    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        session.add(
            ModelTestGenerationTask(
                owner_user_id="alpha",
                provider_kind="senseaudio_video",
                generation_kind="video",
                provider_name="fixture",
                model_slug="fixture",
                status="failed",
                request_payload={"video_asset_ids": ["old"]},
            )
        )
        await session.commit()
        operation = asyncio.create_task(
            ModelTestGenerationAssets(
                session, "alpha", settings, legacy_references=References()
            ).backfill()
        )
        assert await asyncio.to_thread(started.wait, 3)
        operation.cancel()
        await asyncio.sleep(0)
        assert not operation.done()
        finish.set()
        with pytest.raises(asyncio.CancelledError):
            await operation
        assert list(await session.scalars(select(ModelTestGenerationAsset))) == []
    assert source.is_file()
    assert not any(p.is_file() for p in settings.runtime_path.joinpath("accounts").rglob("*"))
