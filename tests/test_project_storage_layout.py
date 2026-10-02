from __future__ import annotations

import os

import httpx
import pytest
from sqlalchemy import delete, select

from app.apps.galgame_workshop.models import GalgameWorkshopProject
from app.apps.visual_workshop.models import VisualWorkshopProject
from app.capabilities.asset_store.layout_migration import reconcile_project_trash
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage
from app.main import app
from app.runtime.config import get_settings
from app.runtime.db import SessionLocal


async def _reset() -> None:
    async with SessionLocal() as session:
        await session.execute(delete(GalgameWorkshopProject))
        await session.execute(delete(VisualWorkshopProject))
        await session.execute(delete(VisualAsset))
        await session.commit()


async def _make_legacy(asset_id: str, *, keep_target: bytes | None = None) -> VisualAsset:
    settings = get_settings()
    storage = AssetStorage(settings)
    async with SessionLocal() as session:
        asset = await session.get(VisualAsset, asset_id)
        assert asset is not None
        target = storage.path_for(asset)
        legacy = storage.legacy_path(asset.storage_key)
        legacy.parent.mkdir(parents=True, exist_ok=True)
        os.replace(target, legacy)
        asset.storage_version = 1
        await session.commit()
        await session.refresh(asset)
        if keep_target is not None:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(keep_target)
        return asset


@pytest.mark.asyncio
async def test_storage_layout_migrates_library_and_project_assets_in_batches() -> None:
    await _reset()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        visual = (
            await client.post(
                "/v1/visual-workshop/projects", json={"title": "视觉", "kind": "canvas"}
            )
        ).json()
        galgame = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "Galgame"})
        ).json()
        library = (
            await client.post(
                "/v1/files",
                files={"upload": ("library.png", b"\x89PNG\r\n\x1a\nlibrary", "image/png")},
            )
        ).json()
        visual_asset = (
            await client.post(
                "/v1/files",
                data={"project_id": visual["id"]},
                files={"upload": ("visual.png", b"\x89PNG\r\n\x1a\nvisual", "image/png")},
            )
        ).json()
        galgame_asset = (
            await client.post(
                f"/v1/galgame-workshop/projects/{galgame['id']}/assets",
                files={"upload": ("galgame.png", b"\x89PNG\r\n\x1a\ngalgame", "image/png")},
            )
        ).json()

        assets = [
            await _make_legacy(library["id"]),
            await _make_legacy(visual_asset["id"]),
            await _make_legacy(galgame_asset["id"]),
        ]
        storage = AssetStorage(get_settings())
        storage.remove_project_root("visual-workshop", visual["id"], workspace_id="default")
        storage.remove_project_root("galgame-workshop", galgame["id"], workspace_id="default")

        status = (await client.get("/v1/file-storage/layout")).json()
        assert status["pending_projects"] == 2
        assert status["pending_assets"] == 3
        assert status["complete"] is False

        first = (await client.post("/v1/file-storage/layout/migrate", params={"limit": 2})).json()
        assert first["migrated_projects"] == 2
        assert first["migrated_assets"] == 2
        assert first["remaining_assets"] == 1

        second = (await client.post("/v1/file-storage/layout/migrate", params={"limit": 2})).json()
        assert second["migrated_assets"] == 1
        assert second["complete"] is True
        repeated = (
            await client.post("/v1/file-storage/layout/migrate", params={"limit": 2})
        ).json()
        assert repeated["processed_assets"] == 0
        assert repeated["complete"] is True

        async with SessionLocal() as session:
            rows = list(
                (
                    await session.execute(
                        select(VisualAsset).where(
                            VisualAsset.id.in_([asset.id for asset in assets])
                        )
                    )
                )
                .scalars()
                .all()
            )
            assert all(asset.storage_version == 2 for asset in rows)
            assert all(storage.path_for(asset).is_file() for asset in rows)
            assert all(not storage.legacy_path(asset.storage_key).exists() for asset in rows)


@pytest.mark.asyncio
async def test_storage_layout_reports_missing_and_conflicting_files_without_data_loss() -> None:
    await _reset()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        missing = (
            await client.post(
                "/v1/files",
                files={"upload": ("missing.png", b"\x89PNG\r\n\x1a\nmissing", "image/png")},
            )
        ).json()
        conflict = (
            await client.post(
                "/v1/files",
                files={"upload": ("conflict.png", b"\x89PNG\r\n\x1a\nsource", "image/png")},
            )
        ).json()
        missing_row = await _make_legacy(missing["id"])
        conflict_row = await _make_legacy(conflict["id"], keep_target=b"different-target")
        storage = AssetStorage(get_settings())
        storage.legacy_path(missing_row.storage_key).unlink()

        result = (await client.post("/v1/file-storage/layout/migrate", params={"limit": 10})).json()
        assert result["missing_files"] == 1
        assert result["conflicts"] == 1
        assert {issue["code"] for issue in result["issues"]} == {
            "source_missing",
            "target_conflict",
        }
        assert storage.legacy_path(conflict_row.storage_key).is_file()
        assert (
            storage.target_path(
                conflict_row.storage_key,
                visual_project_id=None,
                galgame_project_id=None,
                workspace_id="default",
            ).read_bytes()
            == b"different-target"
        )

        async with SessionLocal() as session:
            rows = list(
                (
                    await session.execute(
                        select(VisualAsset).where(
                            VisualAsset.id.in_([missing_row.id, conflict_row.id])
                        )
                    )
                )
                .scalars()
                .all()
            )
            assert all(asset.storage_version == 1 for asset in rows)


@pytest.mark.asyncio
async def test_startup_reconciles_interrupted_project_deletes() -> None:
    await _reset()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        visual = (
            await client.post(
                "/v1/visual-workshop/projects", json={"title": "保留", "kind": "canvas"}
            )
        ).json()
        galgame = (
            await client.post("/v1/galgame-workshop/projects", json={"title": "已删除"})
        ).json()

    storage = AssetStorage(get_settings())
    visual_staged = storage.stage_project_root(
        "visual-workshop", visual["id"], workspace_id="default"
    )
    galgame_staged = storage.stage_project_root(
        "galgame-workshop", galgame["id"], workspace_id="default"
    )
    assert visual_staged is not None and galgame_staged is not None

    async with SessionLocal() as session:
        await session.execute(
            delete(GalgameWorkshopProject).where(GalgameWorkshopProject.id == galgame["id"])
        )
        await session.commit()
        await reconcile_project_trash(session, storage)

    assert storage.project_root("visual-workshop", visual["id"], workspace_id="default").is_dir()
    assert not visual_staged.staged.exists()
    assert not storage.project_root(
        "galgame-workshop", galgame["id"], workspace_id="default"
    ).exists()
    assert not galgame_staged.staged.exists()
