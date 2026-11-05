"""Owned legacy file upgrades preserve original bytes and reject conflicting targets."""

import pytest
from sqlalchemy import select
from tests.test_asset_owned_files import Upload
from tests.test_asset_owned_files import owned as owned

from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage
from fpl_assets.layout import StorageLayouts


async def legacy_file(owned):
    database, settings, cases, _calls = owned
    async with database.sessions() as session:
        uploaded = await cases(session).upload(Upload(), project_id=None, folder_id=None)
    async with database.sessions() as session:
        row, current = await cases(session).content(uploaded.id)
        source = AssetStorage(settings).legacy_path(row.storage_key, owner_user_id="alpha")
        source.parent.mkdir(parents=True, exist_ok=True)
        current.rename(source)
        row.storage_version = 1
        await session.commit()
    return uploaded, source, current


async def test_layout_upgrade_copies_verifies_and_preserves_the_original(owned):
    database, settings, cases, _calls = owned
    asset, source, target = await legacy_file(owned)
    original = source.read_bytes()
    layouts = StorageLayouts(database, settings)
    assert (await layouts.status("alpha")).pending_assets == 1
    assert (await layouts.status("beta")).pending_assets == 0
    result = await layouts.migrate("alpha", 50)
    assert result.complete and result.migrated_assets == 1
    assert target.read_bytes() == source.read_bytes() == original
    assert (await layouts.migrate("alpha", 50)).processed_assets == 0
    async with database.sessions() as session:
        assert (await cases(session).content(asset.id))[1] == target


async def test_layout_replays_verified_copy_after_interruption_without_overwriting_conflicts(owned):
    database, settings, _cases, _calls = owned
    _asset, source, target = await legacy_file(owned)
    layouts = StorageLayouts(database, settings)
    target.write_bytes(b"unique unrelated target")
    result = await layouts.migrate("alpha", 50)
    assert result.conflicts == 1 and not result.complete
    assert target.read_bytes() == b"unique unrelated target" and source.is_file()
    target.write_bytes(source.read_bytes())
    result = await layouts.migrate("alpha", 50)
    assert result.complete and result.already_materialized_assets == 1


async def test_layout_missing_original_and_symlink_targets_are_preserved(owned, tmp_path):
    database, settings, _cases, _calls = owned
    _asset, source, target = await legacy_file(owned)
    unique = tmp_path / "unique-reference"
    unique.write_bytes(b"unique")
    target.symlink_to(unique)
    layouts = StorageLayouts(database, settings)
    result = await layouts.migrate("alpha", 50)
    assert not result.complete and target.is_symlink() and unique.read_bytes() == b"unique"
    target.unlink()
    source.unlink()
    result = await layouts.migrate("alpha", 50)
    assert not result.complete and result.missing_files == 1
    async with database.sessions() as session:
        session.info["owner_user_id"] = "alpha"
        assert (await session.scalar(select(VisualAsset))).storage_version == 1


async def test_layout_concurrent_command_is_rejected(owned):
    from app.capabilities.asset_store.library import AssetError

    database, settings, _cases, _calls = owned
    layouts = StorageLayouts(database, settings)
    async with layouts.lock:
        with pytest.raises(AssetError) as busy:
            await layouts.migrate("alpha", 50)
    assert busy.value.status == 409
