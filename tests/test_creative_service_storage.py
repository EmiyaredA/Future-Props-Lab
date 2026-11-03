"""Creative migration is isolated; its public catalogue is not a private account directory."""

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import insert, select, update

from app.console.creative_workshop.models import CreativeInstallation, CreativeItem, CreativeRelease
from fpl_creative.migrations.registry import MIGRATIONS
from fpl_creative.models import MODELS
from fpl_creative.storage import creative_database
from fpl_runtime.database import ServiceStorageError
from fpl_runtime.migrations import apply, check


def test_creative_owned_migration_replays_and_refuses_another_service(tmp_path):
    path = tmp_path / "service.db"
    apply(path, "creative", MIGRATIONS)
    apply(path, "creative", MIGRATIONS)
    check(path, "creative", MIGRATIONS)
    with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as db:
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert tables == {model.__tablename__ for model in MODELS} | {"_fpl_service_schema"}
        assert not tables.intersection({"users", "visual_assets", "tool_api_integrations"})
        for table in tables:
            assert all(
                row[2] in tables for row in db.execute(f'PRAGMA foreign_key_list("{table}")')
            )
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    with pytest.raises(ValueError, match="归属"):
        apply(path, "models", MIGRATIONS)


async def test_creative_service_keeps_installations_account_scoped(tmp_path):
    apply(tmp_path / "service.db", "creative", MIGRATIONS)
    database = creative_database(tmp_path)
    try:
        async with database.sessions(info={"owner_user_id": "alice"}) as session:
            session.add(
                CreativeItem(
                    id="item", origin_owner_user_id="alice", author_user_id="alice", kind="tool_api"
                )
            )
            await session.flush()
            session.add(CreativeRelease(id="release", item_id="item", version=1, title="public"))
            await session.flush()
            session.add(
                CreativeInstallation(
                    id="install",
                    owner_user_id="alice",
                    installed_by_user_id="alice",
                    release_id="release",
                )
            )
            await session.commit()
        async with database.sessions(info={"owner_user_id": "bob"}) as session:
            assert await session.scalar(select(CreativeItem)) is not None
            assert await session.scalar(select(CreativeInstallation)) is None
    finally:
        await database.close()


async def test_public_catalogue_writes_cannot_cross_account(tmp_path):
    apply(tmp_path / "service.db", "creative", MIGRATIONS)
    database = creative_database(tmp_path)
    try:
        async with database.sessions(info={"owner_user_id": "alice"}) as session:
            session.add(
                CreativeItem(
                    id="item", origin_owner_user_id="alice", author_user_id="alice", kind="tool_api"
                )
            )
            await session.flush()
            session.add(CreativeRelease(id="release", item_id="item", version=1, title="public"))
            await session.commit()
        async with database.sessions(info={"owner_user_id": "bob"}) as session:
            with pytest.raises(ServiceStorageError):
                await session.execute(
                    insert(CreativeItem).values(
                        id="fake",
                        origin_owner_user_id="alice",
                        author_user_id="alice",
                        kind="tool_api",
                    )
                )
            row = await session.get(CreativeItem, "item")
            row.title = "stolen"
            with pytest.raises(ServiceStorageError):
                await session.flush()
            await session.rollback()
            result = await session.execute(
                update(CreativeItem).where(CreativeItem.id == "item").values(title="stolen")
            )
            assert result.rowcount == 0
            result = await session.execute(
                update(CreativeRelease)
                .where(CreativeRelease.id == "release")
                .values(title="stolen")
            )
            assert result.rowcount == 0
            await session.commit()
        async with database.sessions(info={"owner_user_id": "alice"}) as session:
            with pytest.raises(ServiceStorageError, match="归属"):
                await session.execute(
                    update(CreativeItem)
                    .where(CreativeItem.id == "item")
                    .values(origin_owner_user_id="bob")
                )
            with pytest.raises(ServiceStorageError, match="归属"):
                await session.execute(
                    update(CreativeRelease)
                    .where(CreativeRelease.id == "release")
                    .values(item_id="other")
                )
            assert (await session.get(CreativeItem, "item")).title != "stolen"
            assert (await session.get(CreativeRelease, "release")).title == "public"
    finally:
        await database.close()


def test_fresh_creative_storage_does_not_import_foreign_orm(tmp_path):
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            """
import asyncio, sys
from pathlib import Path
from fpl_creative.models import MODELS
from fpl_creative.storage import creative_database
from fpl_creative.migrations.registry import MIGRATIONS
from fpl_runtime.migrations import apply
from app.console.creative_workshop.catalog import CreativeCatalog
from app.console.creative_workshop.models import CreativeItem
root=Path(sys.argv[1]);apply(root/'service.db','creative',MIGRATIONS)
async def run():
 db=creative_database(root)
 try:
  async with db.sessions(info={'owner_user_id':'alice'}) as session:
   session.add(CreativeItem(id='item', origin_owner_user_id='alice',
       author_user_id='alice', kind='tool_api'))
   await session.commit()
 finally: await db.close()
asyncio.run(run())
for name in ('app.main','app.orm','app.runtime.db','app.console.models.accounts',
             'app.integrations.models','app.capabilities.asset_store.models'):
 assert name not in sys.modules, name
""",
            str(tmp_path),
        ],
        cwd=root,
        env={**os.environ, "PYTHONPATH": str(root / "backend")},
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert result.returncode == 0, result.stdout + result.stderr
