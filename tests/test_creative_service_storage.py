"""Creative migration is isolated; its public catalogue is not a private account directory."""

import os
import sqlite3
import subprocess
import sys
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

import pytest
from PIL import Image
from sqlalchemy import insert, select, update

from app.console.creative_workshop.models import CreativeInstallation, CreativeItem, CreativeRelease
from studio.apps.creative_workshop.storage.file_paths import creative_database
from studio.apps.creative_workshop.storage.migrations.registry import MIGRATIONS
from studio.apps.creative_workshop.storage.service_models import MODELS
from studio.runtime.database.migrations import apply, check
from studio.runtime.database.sessions import ServiceStorageError


async def test_creative_catalog_uses_owned_cover_and_skill_directories(tmp_path, monkeypatch):
    from app.console.creative_workshop import files
    from app.console.creative_workshop.catalog import CreativeCatalog
    from app.console.creative_workshop.schemas import CreativeDraftIn
    from app.console.creative_workshop.sources import MemoryIncoming
    from studio.contracts.identity.principal import StudioPrincipal

    def reject_legacy_settings():
        pytest.fail("Independent Creative attempted to load legacy storage settings")

    class Authors:
        async def name(self, *, item_id, author_id):
            assert item_id
            return author_id

    monkeypatch.setattr(files, "get_settings", reject_legacy_settings)
    apply(tmp_path / "service.db", "creative", MIGRATIONS)
    database = creative_database(tmp_path)
    image = BytesIO()
    Image.new("RGB", (320, 180), "white").save(image, format="PNG")
    archive = BytesIO()
    skill = "---\nname: owned-skill\ndescription: An owned example\n---\n\nUsage."
    with ZipFile(archive, "w") as zipped:
        zipped.writestr("SKILL.md", skill)
    actor = StudioPrincipal(
        user_id="alice",
        platform_role="user",
        auth_kind="session",
        must_change_password=False,
        scopes=frozenset({"studio:read", "studio:private_read", "studio:write"}),
    )
    try:
        async with database.sessions(
            info={"owner_user_id": "alice", "creative_authors": Authors()}
        ) as session:
            catalog = CreativeCatalog(session, actor)
            draft = await catalog.create(
                CreativeDraftIn(kind="skill", title="Owned cover", summary="An owned example")
            )
            updated = await catalog.upload_cover(
                draft.id, draft.revision, MemoryIncoming(image.getvalue())
            )
            cover = await catalog.cover_file(updated.id, draft=True)
            file_root = tmp_path / "accounts" / "alice" / "creative-workshop"
            assert cover.is_relative_to(file_root)
            assert cover.is_file()
            updated = await catalog.upload_skill(
                draft.id, updated.revision, MemoryIncoming(archive.getvalue())
            )
            published = await catalog.publish(draft.id, updated.revision)
            assert published.status == "published"
            release = file_root / "skill-releases" / published.current_release_id
            assert (release / "SKILL.md").read_text() == skill
    finally:
        await database.close()


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
from studio.apps.creative_workshop.storage.service_models import MODELS
from studio.apps.creative_workshop.storage.file_paths import creative_database
from studio.apps.creative_workshop.storage.migrations.registry import MIGRATIONS
from studio.runtime.database.migrations import apply
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
for name in ('studio.assembly.website.application',
             'studio.assembly.website.models','studio.runtime.database.website',
             'studio.apps.identity.storage.models.accounts',
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
