from __future__ import annotations

import os
from datetime import timedelta
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete

from app.capabilities.asset_store.models import VisualAsset
from app.llm.models import ModelTestGenerationAsset, ModelTestGenerationTask
from app.llm.playground.generation_assets import GenerationAssetError, ModelTestGenerationAssets
from app.main import app
from app.runtime.db import SessionLocal
from studio.apps.visual_workshop.outputs.models import VisualNodeOutput
from studio.config.settings import get_settings
from studio.runtime.time import utc_now


def _task(*, status: str = "failed", payload: dict | None = None) -> ModelTestGenerationTask:
    return ModelTestGenerationTask(
        owner_user_id="test-user",
        provider_kind="senseaudio_video",
        generation_kind="video",
        provider_name="test",
        model_slug="test-video",
        request_payload=payload or {},
        status=status,
    )


@pytest.mark.asyncio
async def test_private_asset_upload_is_atomic_and_claimed_assets_are_immutable() -> None:
    settings = get_settings()
    before = {
        path.name
        for path in settings.account_model_test_path("test-user", "references").glob("*")
        if path.is_file()
    }
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        invalid = await client.post(
            "/v1/model-test/generation-assets",
            files=[
                ("files", ("valid.mp3", b"ID3valid", "audio/mpeg")),
                ("files", ("invalid.mp4", b"not-video", "video/mp4")),
            ],
        )
        assert invalid.status_code == 422
        after = {
            path.name
            for path in settings.account_model_test_path("test-user", "references").glob("*")
            if path.is_file()
        }
        assert after == before

        uploaded = await client.post(
            "/v1/model-test/generation-assets",
            files={"files": ("reference.mp4", b"\x00\x00\x00\x18ftypisom", "video/mp4")},
        )
        assert uploaded.status_code == 200, uploaded.text
        asset_id = uploaded.json()["items"][0]["id"]

        async with SessionLocal() as session:
            first = _task()
            second = _task()
            session.add_all((first, second))
            await session.flush()
            first_id, second_id = first.id, second.id
            await ModelTestGenerationAssets(session, "test-user").claim_for_task(
                first.id, (([asset_id], "reference_video", "video"),)
            )
            await session.commit()
            with pytest.raises(GenerationAssetError, match="已被其他任务使用"):
                await ModelTestGenerationAssets(session, "test-user").claim_for_task(
                    second.id, (([asset_id], "reference_video", "video"),)
                )
            await session.rollback()

        claimed_delete = await client.delete(f"/v1/model-test/generation-assets/{asset_id}")
        assert claimed_delete.status_code == 409

        async with SessionLocal() as session:
            claimed = await session.get(ModelTestGenerationAsset, asset_id)
            assert claimed is not None
            claimed_path = (
                settings.account_model_test_path("test-user", "references") / claimed.storage_key
            )
        deleted_task = await client.delete(
            f"/v1/model-test/generation-tasks/{first_id}",
            params={"expected_revision": 0},
        )
        assert deleted_task.status_code == 200
        assert not claimed_path.exists()

        async with SessionLocal() as session:
            await session.execute(
                delete(ModelTestGenerationTask).where(ModelTestGenerationTask.id == second_id)
            )
            await session.commit()
            assert await session.get(ModelTestGenerationAsset, asset_id) is None


@pytest.mark.asyncio
async def test_cleanup_removes_expired_drafts_temp_files_and_orphans() -> None:
    settings = get_settings()
    root = settings.account_model_test_path("test-user", "references")
    temp_dir = root / ".tmp"
    temp_dir.mkdir(parents=True, exist_ok=True)
    storage_key = uuid4().hex
    draft_path = root / storage_key
    draft_path.write_bytes(b"ID3draft")
    orphan_path = root / uuid4().hex
    orphan_path.write_bytes(b"orphan")
    stale_temp = temp_dir / uuid4().hex
    stale_temp.write_bytes(b"partial")
    old_timestamp = (utc_now() - timedelta(hours=25)).timestamp()
    os.utime(orphan_path, (old_timestamp, old_timestamp))
    stale_temp.touch()
    stale_temp.chmod(0o600)
    os.utime(stale_temp, (old_timestamp, old_timestamp))

    async with SessionLocal() as session:
        draft = ModelTestGenerationAsset(
            owner_user_id="test-user",
            original_filename="draft.mp3",
            storage_key=storage_key,
            media_kind="audio",
            mime_type="audio/mpeg",
            byte_size=8,
            created_at=utc_now() - timedelta(hours=25),
        )
        session.add(draft)
        await session.commit()
        draft_id = draft.id

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/v1/model-test/generation-assets/cleanup")
        assert response.status_code == 200
        assert response.json()["deleted_assets"] == 1
        assert response.json()["deleted_orphan_files"] >= 2

    async with SessionLocal() as session:
        assert await session.get(ModelTestGenerationAsset, draft_id) is None
    assert not draft_path.exists()
    assert not orphan_path.exists()
    assert not stale_temp.exists()


@pytest.mark.asyncio
async def test_legacy_backfill_is_idempotent_skips_active_tasks_and_keeps_public_files() -> None:
    settings = get_settings()
    public_key = uuid4().hex
    public_path = (settings.account_path("test-user") / "legacy-assets") / public_key
    public_path.parent.mkdir(parents=True, exist_ok=True)
    public_path.write_bytes(b"\x00\x00\x00\x18ftypisom")
    async with SessionLocal() as session:
        public = VisualAsset(
            owner_user_id="test-user",
            original_filename="legacy.mp4",
            display_name="legacy.mp4",
            storage_key=public_key,
            media_kind="video",
            mime_type="video/mp4",
            byte_size=16,
        )
        session.add(public)
        await session.flush()
        terminal = _task(payload={"video_asset_ids": [public.id]})
        active = _task(status="queued", payload={"video_asset_ids": [public.id]})
        session.add_all((terminal, active))
        await session.commit()
        terminal_id, active_id = terminal.id, active.id
        original_id = public.id

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        status = (await client.get("/v1/model-test/generation-assets/backfill-status")).json()
        assert status["pending_tasks"] >= 2
        assert status["eligible_tasks"] >= 1
        assert status["active_tasks"] >= 1

        result = (await client.post("/v1/model-test/generation-assets/backfill")).json()
        assert result["processed_tasks"] >= 1
        assert result["copied_assets"] >= 1
        assert result["skipped_active"] >= 1
        repeated = (await client.post("/v1/model-test/generation-assets/backfill")).json()
        assert repeated["processed_tasks"] == 0
        assert repeated["remaining_tasks"] >= 1

    async with SessionLocal() as session:
        terminal = await session.get(ModelTestGenerationTask, terminal_id)
        active = await session.get(ModelTestGenerationTask, active_id)
        assert terminal is not None and terminal.revision == 1
        private_id = terminal.request_payload["video_asset_ids"][0]
        assert private_id != original_id
        private = await session.get(ModelTestGenerationAsset, private_id)
        assert private is not None and private.task_id == terminal_id
        assert active is not None and active.request_payload["video_asset_ids"] == [original_id]
        private_path = (
            settings.account_model_test_path("test-user", "references") / private.storage_key
        )
        assert public_path.is_file()
        assert private_path.read_bytes() == public_path.read_bytes()
        await session.execute(
            delete(ModelTestGenerationTask).where(
                ModelTestGenerationTask.id.in_((terminal_id, active_id))
            )
        )
        await session.execute(delete(VisualNodeOutput))
        await session.execute(delete(VisualAsset).where(VisualAsset.id == original_id))
        await session.commit()
    private_path.unlink(missing_ok=True)
    public_path.unlink(missing_ok=True)
    assert public_path.exists() is False
