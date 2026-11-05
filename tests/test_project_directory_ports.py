"""The same deletion compensation mechanism accepts two independent filesystem layouts."""

import asyncio

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.capabilities.asset_store.storage import AssetStorage
from studio.apps.asset_library.settings import StorageSettings
from studio.apps.director_desk.storage.file_paths import DirectorStorage
from studio.runtime.database.project_files import deleting_project_layout


@pytest.fixture(params=["assets", "director"])
def storage(request, tmp_path):
    if request.param == "assets":
        return AssetStorage(StorageSettings(tmp_path / "test.db"))
    return DirectorStorage(tmp_path)


@pytest.mark.parametrize("cancel", [False, True])
async def test_committed_deletion_and_cancelled_transaction_preserve_files(
    storage, tmp_path, cancel
):
    engine = create_async_engine("sqlite+aiosqlite:///" + str(tmp_path / "records.db"))
    sessions = async_sessionmaker(engine)
    root = storage.project_root("director-desk", "project", owner_user_id="owner")
    root.mkdir(parents=True)
    (root / "original").write_bytes(b"owned original")
    try:
        async with engine.begin() as connection:
            await connection.execute(text("CREATE TABLE projects (id TEXT PRIMARY KEY)"))
            await connection.execute(text("INSERT INTO projects VALUES ('project')"))
        async with sessions() as session:

            async def delete():
                async with deleting_project_layout(
                    session, storage, "director-desk", "project", owner_user_id="owner"
                ):
                    assert not root.exists()
                    await session.execute(text("DELETE FROM projects WHERE id='project'"))
                    if cancel:
                        raise asyncio.CancelledError()

            if cancel:
                with pytest.raises(asyncio.CancelledError):
                    await delete()
            else:
                await delete()
        async with sessions() as session:
            count = await session.scalar(text("SELECT COUNT(*) FROM projects"))
        assert count == int(cancel)
        if cancel:
            assert (root / "original").read_bytes() == b"owned original"
        else:
            assert not root.exists()
        assert not list(tmp_path.glob(".trash/owner/director-desk/*"))
    finally:
        await engine.dispose()
