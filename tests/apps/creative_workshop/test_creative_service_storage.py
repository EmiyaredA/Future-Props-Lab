"""Creative migration is isolated; its public catalogue is not a private account directory."""

import hashlib
import json
import os
import sqlite3
import subprocess
import sys
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from PIL import Image
from sqlalchemy import insert, select, update

from creative_test_support import isolated_resources
from studio.apps.creative_workshop.storage.file_paths import creative_database
from studio.apps.creative_workshop.storage.migration_catalog import CreativeImportReceipt
from studio.apps.creative_workshop.storage.migrations.registry import MIGRATIONS
from studio.apps.creative_workshop.storage.models import (
    CreativeInstallation,
    CreativeItem,
    CreativeRelease,
)
from studio.apps.creative_workshop.storage.service_models import MODELS
from studio.assembly.independent.creative_workshop.application import create_app
from studio.contracts.gateway.protocol_hash import public_contract
from studio.contracts.gateway.routing import RouteCatalog
from studio.runtime.database.migrations import apply, check
from studio.runtime.database.sessions import ServiceStorageError
from studio.runtime.files.raster import RasterPreviews


async def test_creative_readiness_requires_started_storage_and_complete_release(tmp_path):
    repo = Path(__file__).resolve().parents[3]
    state = tmp_path / "state"
    apply(state / "service.db", "creative", MIGRATIONS)
    schema = repo / "web/src/generated/openapi.json"
    catalog = RouteCatalog.read(repo / "deploy/contracts/ownership.json")
    build = "b" * 20
    web = tmp_path / "web"
    web.mkdir()
    page = b"<!doctype html><title>Creative release</title>"
    (web / "creative.html").write_bytes(page)
    (web / "build.json").write_text(
        json.dumps(
            {
                "version": 1,
                "service": "creative",
                "build_id": build,
                "entry": "creative.html",
                "api_sha256": public_contract(json.loads(schema.read_text()), "creative", catalog),
                "files": [
                    {
                        "path": "creative.html",
                        "sha256": hashlib.sha256(page).hexdigest(),
                        "bytes": len(page),
                    }
                ],
            }
        )
    )
    options = {
        "state_root": state,
        "catalog": catalog,
        "schema_path": schema,
        "public_key": Ed25519PrivateKey.generate().public_key(),
        "credential": "a" * 40,
    }
    credentials = ("b" * 40, "c" * 40, "d" * 40)
    api_only = create_app(**options, install_credentials=credentials)
    async with (
        api_only.router.lifespan_context(api_only),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=api_only), base_url="http://creative"
        ) as client,
    ):
        assert (await client.get("/ready")).status_code == 503
    with pytest.raises(ValueError, match="公开接口"):
        create_app(**options, web_root=web)
    app = create_app(**options, install_credentials=credentials, web_root=web)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://creative"
    ) as client:
        assert (await client.get("/ready")).status_code == 503
        async with app.router.lifespan_context(app):
            assert (await client.get("/ready")).json() == {
                "status": "ready",
                "service": "creative",
                "version": build,
            }
            assert (await client.get("/creative-workshop")).content == page
        assert (await client.get("/ready")).status_code == 503


async def test_creative_catalog_uses_owned_cover_and_skill_directories(tmp_path, monkeypatch):
    from studio.apps.creative_workshop.catalog import CreativeCatalog
    from studio.apps.creative_workshop.catalog_sources import MemoryIncoming
    from studio.contracts.creative_workshop.catalog import CreativeDraftIn
    from studio.contracts.identity.principal import StudioPrincipal

    def reject_legacy_settings():
        pytest.fail("Independent Creative attempted to load legacy storage settings")

    class Authors:
        async def name(self, *, item_id, author_id):
            assert item_id
            return author_id

    monkeypatch.setattr("studio.config.settings.get_settings", reject_legacy_settings)
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
        async with database.sessions(info={"owner_user_id": "alice"}) as session:
            catalog = CreativeCatalog(
                session, actor, resources=isolated_resources(tmp_path, Authors())
            )
            draft = await catalog.create(
                CreativeDraftIn(kind="skill", title="Owned cover", summary="An owned example")
            )
            updated = await catalog.upload_cover(
                draft.id, draft.revision, MemoryIncoming(image.getvalue())
            )
            cover = await catalog.cover_file(updated.id, draft=True, previews=RasterPreviews())
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
        assert tables == {model.__tablename__ for model in (*MODELS, CreativeImportReceipt)} | {
            "_fpl_service_schema"
        }
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
    root = Path(__file__).resolve().parents[3]
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
from studio.apps.creative_workshop.catalog import CreativeCatalog
from studio.apps.creative_workshop.storage.models import CreativeItem
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
             'studio.apps.integrations.storage.models','studio.apps.asset_library.storage.models'):
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
