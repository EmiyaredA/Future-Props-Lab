"""Assets storage checks for invisible, replayable Thought archive batches."""

import asyncio
import hashlib
from io import BytesIO
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from studio.apps.asset_library.deletions import FileCleanup
from studio.apps.asset_library.settings import StorageSettings
from studio.apps.asset_library.storage.file_paths import AssetStorage
from studio.apps.asset_library.storage.migrations.registry import MIGRATIONS
from studio.apps.asset_library.storage.models import VisualAsset
from studio.apps.asset_library.storage.service_models import (
    MODELS,
    AssetReferencePin,
    AssetReferenceSet,
)
from studio.apps.asset_library.thought.thought_archives import ThoughtArchives
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.thought_workshop.thought_archives import ArchiveBatchKey, ArchiveManifest
from studio.contracts.thought_workshop.thought_uploads import ThoughtUploadDescription
from studio.runtime.database.migrations import apply
from studio.runtime.database.sessions import Database


class Upload:
    def __init__(self, data):
        self.file = BytesIO(data)

    async def read(self, size):
        return self.file.read(size)

    async def close(self):
        self.file.close()


def describe(data):
    return ThoughtUploadDescription(
        "attachment", "file.txt", "text/plain", len(data), hashlib.sha256(data).hexdigest()
    )


async def active():
    return


@pytest.fixture
async def assets(tmp_path):
    database = Database("assets", tmp_path, models=MODELS)
    apply(database.path, "assets", MIGRATIONS)
    try:
        yield database, StorageSettings(database.path)
    finally:
        await database.close()


async def test_archive_staging_replays_and_publishes_assets_and_initial_pins_together(
    assets, monkeypatch
):
    database, settings = assets
    staging = ThoughtArchives(database, settings)
    key = ArchiveBatchKey(batch_id=uuid4().hex, source_sha256="a" * 64)
    data = b"private content"
    description = describe(data)

    async def stage():
        return await staging.stage_file(
            owner="owner",
            key=key,
            ordinal=0,
            description=description,
            incoming=Upload(data),
            require_active=active,
        )

    first, replay = await asyncio.gather(stage(), stage())
    assert first == replay
    async with database.sessions(info={"owner_user_id": "owner"}) as session:
        assert await session.get(VisualAsset, first["id"]) is None
        assert (await session.scalars(select(AssetReferenceSet))).all() == []

    manifest = ArchiveManifest(
        files=[{"ordinal": 0, "descriptor_sha256": description.fingerprint}],
        projections=[
            {
                "resource_kind": "note",
                "resource_id": str(uuid4()),
                "resource_revision": 12,
                "asset_ids": [first["id"]],
            }
        ],
    )
    with pytest.raises(AssetError) as denied:
        await staging.seal(owner="other", key=key, manifest=manifest)
    assert denied.value.code == "archive_files_incomplete"
    assert await staging.seal(owner="owner", key=key, manifest=manifest) == "sealed"
    with pytest.raises(AssetError) as changed:
        await staging.settle(owner="owner", key=key, commit=True, manifest_sha256="b" * 64)
    assert changed.value.code == "archive_manifest_conflict"

    commit = AsyncSession.commit

    async def lose_ack(session):
        await commit(session)
        raise ConnectionError("response lost after commit")

    with monkeypatch.context() as patch:
        patch.setattr(AsyncSession, "commit", lose_ack)
        with pytest.raises(ConnectionError):
            await staging.settle(
                owner="owner", key=key, commit=True, manifest_sha256=manifest.fingerprint
            )

    # A restart and a repeated source outcome do not copy files or create another projection.
    await database.close()
    restarted = Database("assets", settings.runtime_path, models=MODELS)
    try:
        staging = ThoughtArchives(restarted, settings)
        for _ in range(2):
            assert (
                await staging.settle(
                    owner="owner", key=key, commit=True, manifest_sha256=manifest.fingerprint
                )
                == "published"
            )
        async with restarted.sessions(info={"owner_user_id": "owner"}) as session:
            row = await session.get(VisualAsset, first["id"])
            assert AssetStorage(settings).path_for(row).read_bytes() == data
            assert len((await session.scalars(select(VisualAsset))).all()) == 1
            projection = (await session.scalars(select(AssetReferenceSet))).one()
            assert projection.resource_revision == 12
            pin = (await session.scalars(select(AssetReferencePin))).one()
            assert (pin.reference_set_id, pin.asset_id) == (projection.id, first["id"])
        async with restarted.sessions(info={"owner_user_id": "other"}) as session:
            assert await session.get(VisualAsset, first["id"]) is None
    finally:
        await restarted.close()


async def test_archive_abort_cleans_files_and_blocks_late_stage(assets):
    database, settings = assets
    staging = ThoughtArchives(database, settings)
    key = ArchiveBatchKey(batch_id=uuid4().hex, source_sha256="a" * 64)
    data = b"private content"
    description = describe(data)

    async def stage(incoming):
        return await staging.stage_file(
            owner="owner",
            key=key,
            ordinal=0,
            description=description,
            incoming=Upload(incoming),
            require_active=active,
        )

    with pytest.raises(AssetError) as changed:
        await stage(b"modified bytes!")
    assert changed.value.code == "archive_file_changed"
    await stage(data)
    await staging.settle(owner="owner", key=key, commit=False)
    assert await staging.settle(owner="owner", key=key, commit=False) == "aborted"
    with pytest.raises(AssetError) as late:
        await stage(data)
    assert late.value.code == "archive_aborted"
    assert await FileCleanup(database, settings).run_once() == 1
    async with database.sessions(info={"owner_user_id": "owner"}) as session:
        assert (await session.scalars(select(VisualAsset))).all() == []
