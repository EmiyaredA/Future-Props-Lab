"""A lost commit acknowledgement must never delete possibly committed file content."""

import pytest
from sqlalchemy import select
from tests.test_asset_owned_files import Upload
from tests.test_asset_owned_files import owned as owned

from app.capabilities.asset_store.library import AssetError
from app.capabilities.asset_store.models import VisualAsset
from studio.contracts.asset_library.files import LibraryAssetImportIn


async def test_upload_lost_commit_acknowledgement_keeps_the_committed_original(owned, monkeypatch):
    database, settings, cases, _calls = owned
    async with database.sessions() as session:
        commit = session.commit

        async def lost_ack():
            await commit()
            raise ConnectionError("synthetic lost acknowledgement")

        monkeypatch.setattr(session, "commit", lost_ack)
        with pytest.raises(ConnectionError):
            await cases(session).upload(Upload(), project_id=None, folder_id=None)
    async with database.sessions() as session:
        session.info["owner_user_id"] = "alpha"
        rows = list((await session.scalars(select(VisualAsset))).all())
        assert len(rows) == 1
        _row, path = await cases(session).content(rows[0].id)
        assert path.is_file() and path.is_relative_to(settings.account_path("alpha"))


async def test_copy_lost_commit_acknowledgement_keeps_all_committed_copies(owned, monkeypatch):
    database, _settings, cases, _calls = owned
    async with database.sessions() as session:
        asset = await cases(session).upload(Upload(), project_id="owned-project", folder_id=None)
    async with database.sessions() as session:
        commit = session.commit

        async def lost_ack():
            await commit()
            raise ConnectionError("synthetic lost acknowledgement")

        monkeypatch.setattr(session, "commit", lost_ack)
        with pytest.raises(AssetError) as unknown:
            await cases(session).import_project_assets_to_library(
                LibraryAssetImportIn(
                    source_project_id="owned-project",
                    asset_ids=[asset.id],
                )
            )
        assert unknown.value.code == "asset_commit_unknown"
    async with database.sessions() as session:
        session.info["owner_user_id"] = "alpha"
        rows = list((await session.scalars(select(VisualAsset))).all())
        assert len(rows) == 2
        for row in rows:
            assert (await cases(session).content(row.id))[1].is_file()


async def test_unconfirmed_upload_keeps_its_bytes_without_creating_a_database_record(
    owned, monkeypatch
):
    database, settings, cases, _calls = owned
    async with database.sessions() as session:

        async def failed_commit():
            raise ConnectionError("synthetic commit outcome unknown")

        monkeypatch.setattr(session, "commit", failed_commit)
        with pytest.raises(ConnectionError):
            await cases(session).upload(Upload(), project_id=None, folder_id=None)
    async with database.sessions() as session:
        session.info["owner_user_id"] = "alpha"
        assert await session.scalar(select(VisualAsset)) is None
    files = list((settings.account_path("alpha") / "library/assets").glob("*"))
    assert len([path for path in files if path.is_file()]) == 1
