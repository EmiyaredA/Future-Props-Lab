"""Account isolation and the immutable transition from the last workspace schema."""

import sqlite3
from contextlib import aclosing
from uuid import uuid4

import httpx
import pytest

from app.capabilities.asset_store.account_upgrade import _copy_root
from app.capabilities.asset_store.storage import AssetStorage
from app.console.governance.provisioning import create_account
from app.console.models import User
from app.main import app
from app.runtime.db import SessionLocal
from db.migrations.registry import MIGRATIONS
from studio.config.settings import Settings

pytestmark = pytest.mark.real_auth
PASSWORD = "Account-Owned-Test-Password-2026!"


async def test_readiness_identifies_account_maintenance_for_the_desktop_shell(monkeypatch):
    monkeypatch.setattr(app.state, "storage_upgrade_required", True, raising=False)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="http://test"
    ) as client:
        response = await client.get("/ready")
    assert response.status_code == 503
    assert response.json()["code"] == "account_storage_upgrade_required"


async def account_client(*, admin=False):
    username = "owned-" + uuid4().hex[:12]
    async with SessionLocal() as session:
        user, _ = await create_account(
            session,
            username=username,
            display_name=username,
            platform_role="admin" if admin else "user",
            password=PASSWORD,
        )
        identity = user.id
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test")
    response = await client.post(
        "/v1/auth/login", json={"username": username, "password": PASSWORD}
    )
    assert response.status_code == 200, response.text
    client.headers.update({"Origin": "http://test", "X-CSRF-Token": client.cookies["fpl_csrf"]})
    return client, identity


async def test_auth_has_one_account_scope_and_only_two_roles():
    client, identity = await account_client(admin=True)
    async with aclosing(client):
        body = (await client.get("/v1/auth/me")).json()
        assert body["user"]["id"] == identity
        assert body["user"]["platform_role"] == "admin"
        assert "workspace" not in body and "policy_revision" not in body
        assert "content.write" in body["permission_keys"]
        for path in [
            "/v1/account/workspaces",
            "/v1/platform/workspaces",
            "/v1/public-workspace",
            "/v1/platform/permission-policy",
            "/v1/account/cross-workspace-call-logs",
        ]:
            assert (await client.get(path)).status_code == 404, path


async def test_private_projects_are_isolated_including_administrators():
    owner, _ = await account_client()
    other, _ = await account_client()
    admin, _ = await account_client(admin=True)
    async with aclosing(owner), aclosing(other), aclosing(admin):
        created = await owner.post(
            "/v1/thought-workshop/knowledge-bases", json={"title": "Private"}
        )
        assert created.status_code == 200, created.text
        identity = created.json()["id"]
        for outsider in [other, admin]:
            response = await outsider.get(f"/v1/thought-workshop/knowledge-bases/{identity}")
            assert response.status_code == 404, response.text
            listing = await outsider.get("/v1/thought-workshop/knowledge-bases")
            assert identity not in {row["id"] for row in listing.json()}
        assert (
            await owner.get(f"/v1/thought-workshop/knowledge-bases/{identity}")
        ).status_code == 200


async def test_read_only_api_key_does_not_inherit_write_or_admin_governance():
    owner, _ = await account_client(admin=True)
    async with aclosing(owner):
        response = await owner.post(
            "/v1/account/api-keys", json={"name": "read", "scopes": ["studio:read"]}
        )
        assert response.status_code == 201, response.text
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app),
            base_url="http://test",
            headers={"Authorization": "Bearer " + response.json()["secret"]},
        ) as key:
            assert (await key.get("/v1/thought-workshop/knowledge-bases")).status_code == 200
            assert (
                await key.post("/v1/thought-workshop/knowledge-bases", json={"title": "denied"})
            ).status_code == 403
            assert (await key.get("/v1/platform/accounts")).status_code == 403


async def test_disabled_account_and_old_session_cannot_access_data():
    admin, _ = await account_client(admin=True)
    user, identity = await account_client()
    async with aclosing(admin), aclosing(user):
        async with SessionLocal() as session:
            row = await session.get(User, identity)
            revision = row.revision
        changed = await admin.patch(
            f"/v1/platform/accounts/{identity}",
            json={"status": "disabled", "expected_revision": revision},
        )
        assert changed.status_code == 200, changed.text
        assert (await user.get("/v1/auth/me")).status_code == 401


def legacy_database():
    connection = sqlite3.connect(":memory:")
    for migration in MIGRATIONS[
        : next(i for i, m in enumerate(MIGRATIONS) if m.migration_id == "0116_account_ownership")
    ]:
        connection.execute("PRAGMA foreign_keys=" + ("OFF" if migration.foreign_keys_off else "ON"))
        connection.executescript(migration.sql)
    connection.execute("PRAGMA foreign_keys=OFF")
    return connection


def old_account(connection, identity, role="member"):
    connection.execute(
        "INSERT INTO users(id,username,username_normalized,password_hash,platform_role) "
        "VALUES (?,?,?,?,?)",
        (identity, identity, identity, "unused-test-hash", role),
    )


def old_space(connection, identity, owner):
    connection.execute(
        "INSERT OR IGNORE INTO workspaces(id,name) VALUES (?,?)", (identity, identity)
    )
    connection.execute(
        "INSERT INTO workspace_memberships(id,user_id,workspace_id,role,status) "
        "VALUES (?,?,?,'owner','active')",
        ("membership-" + identity, owner, identity),
    )


def test_legacy_upgrade_maps_owners_keeps_resource_ids_and_revokes_credentials():
    c = legacy_database()
    old_account(c, "alice", "super_admin")
    old_account(c, "bob")
    old_space(c, "default", "alice")
    old_space(c, "second", "alice")
    old_space(c, "bob-space", "bob")
    c.execute(
        "INSERT INTO thought_knowledge_bases(id,workspace_id,title,created_at,updated_at) "
        "VALUES ('book','second','Title',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"
    )
    c.execute(
        "INSERT INTO management_api_keys(id,user_id,workspace_id,name,key_hash,key_prefix,"
        "scopes,expires_at) VALUES ('key','bob','second','Old','hash','fpm_',"
        "'[\"studio:write\"]','2099-01-01')"
    )
    c.commit()
    c.executescript(next(m.sql for m in MIGRATIONS if m.migration_id == "0116_account_ownership"))
    assert c.execute(
        "SELECT owner_user_id,title FROM thought_knowledge_bases WHERE id='book'"
    ).fetchone() == ("alice", "Title")
    assert c.execute("SELECT platform_role FROM users WHERE id='alice'").fetchone() == ("admin",)
    assert c.execute("SELECT platform_role FROM users WHERE id='bob'").fetchone() == ("user",)
    assert c.execute("SELECT revoked_at FROM management_api_keys").fetchone()[0]
    assert not c.execute(
        "SELECT name FROM sqlite_master WHERE name IN "
        "('workspaces','workspace_memberships','workspace_invitations')"
    ).fetchall()
    assert not c.execute("PRAGMA foreign_key_check").fetchall()
    for identity in ["alice", "bob"]:
        c.execute(
            "INSERT INTO visual_asset_folders(id,owner_user_id,name) VALUES (?,?,?)",
            ("folder-" + identity, identity, "Private files"),
        )
    with pytest.raises(sqlite3.IntegrityError):
        c.execute(
            "INSERT INTO visual_asset_folders(id,owner_user_id,name) "
            "VALUES ('duplicate','alice','private files')"
        )
    c.close()


def test_legacy_upgrade_rejects_unowned_or_ambiguous_spaces():
    c = legacy_database()
    old_account(c, "alice")
    # Existing accounts cannot silently claim an unowned default scope.
    with pytest.raises(sqlite3.IntegrityError):
        c.executescript(
            next(m.sql for m in MIGRATIONS if m.migration_id == "0116_account_ownership")
        )
    c.close()


def test_layout_copy_is_idempotent_and_does_not_overwrite_conflicts(tmp_path):
    source = tmp_path / "old"
    source.mkdir()
    (source / "file.bin").write_bytes(b"original")
    _copy_root(tmp_path, "old", "accounts/alice/library")
    _copy_root(tmp_path, "old", "accounts/alice/library")
    assert (source / "file.bin").read_bytes() == b"original"
    destination = tmp_path / "accounts/alice/library/file.bin"
    assert destination.read_bytes() == b"original"
    destination.write_bytes(b"conflict")
    with pytest.raises(ValueError, match="conflict"):
        _copy_root(tmp_path, "old", "accounts/alice/library")
    assert destination.read_bytes() == b"conflict"


def test_layout_rejects_symlinks_and_traversal(tmp_path):
    (tmp_path / "old").mkdir()
    (tmp_path / "old/link").symlink_to(tmp_path)
    with pytest.raises(ValueError, match="symlinks"):
        _copy_root(tmp_path, "old", "accounts/alice")
    (tmp_path / "target").mkdir()
    (tmp_path / "target/link").symlink_to(tmp_path)
    with pytest.raises(ValueError, match="symlinks"):
        _copy_root(tmp_path, "absent", "target")
    with pytest.raises(ValueError, match="path"):
        _copy_root(tmp_path, "../outside", "accounts/alice")


def test_runtime_storage_has_no_default_account_fallback(tmp_path):
    storage = AssetStorage(Settings(fpl_database_path=str(tmp_path / "test.db")))
    assert (
        storage.project_root("visual-workshop", "project", owner_user_id="alice")
        == tmp_path / "accounts/alice/applications/visual-workshop/projects/project"
    )
    with pytest.raises(ValueError):
        storage.project_root("visual-workshop", "project", owner_user_id="")


def test_registered_runner_preserves_history_templates_and_agent_allocations(tmp_path):
    import json

    from tests.migration_fixtures import apply_migrations as apply_legacy

    from db.migrations import apply_migrations
    from db.migrations.runner import connect_database

    path = tmp_path / "ownership-upgrade.db"
    apply_legacy(path)
    with connect_database(path) as c:
        old_account(c, "alice", "super_admin")
        old_space(c, "default", "alice")
        old_space(c, "second", "alice")
        for index, scope in enumerate(["default", "second"]):
            c.execute(
                "INSERT INTO model_providers(id,workspace_id,name,kind,origin,template_key) "
                "VALUES (?,?,?,'openai','role_template','shared-connection')",
                (f"p{index}", scope, f"Gateway {index}"),
            )
            c.execute(
                "INSERT INTO model_entries(id,workspace_id,provider_id,slug,origin,template_key) "
                "VALUES (?,?,?,'model','role_template','shared-model')",
                (f"m{index}", scope, f"p{index}"),
            )
            payload = {
                "grants": [{"user_id": "alice", "agent_id": "codex", "purpose": "amadeus"}],
                "managed": ["codex:amadeus"],
            }
            c.execute(
                "INSERT INTO platform_settings(id,payload,revision) VALUES (?,?,2)",
                ("code_agents:" + scope, json.dumps(payload)),
            )
        before = c.execute("SELECT migration_id,checksum FROM schema_migrations").fetchall()
        format_guards = c.execute(
            "SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name"
        ).fetchall()
        c.commit()
    assert apply_migrations(path) == (MIGRATIONS[-1].migration_id, True)
    with connect_database(path) as c:
        assert (
            c.execute("SELECT migration_id,checksum FROM schema_migrations").fetchall()[
                : len(before)
            ]
            == before
        )
        assert c.execute(
            "SELECT owner_user_id,provider_id FROM model_entries WHERE id='m1'"
        ).fetchone() == ("alice", "p1")
        assert c.execute(
            "SELECT origin,template_key FROM model_entries WHERE id='m1'"
        ).fetchone() == ("user", None)
        assert c.execute("SELECT count(*) FROM model_providers").fetchone() == (2,)
        grants = json.loads(
            c.execute("SELECT payload FROM platform_settings WHERE id='code_agents'").fetchone()[0]
        )
        assert grants == payload
        assert not c.execute(
            "SELECT sql FROM sqlite_master WHERE sql LIKE '%REFERENCES workspaces%'"
        ).fetchall()
        assert (
            c.execute(
                "SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name"
            ).fetchall()
            == format_guards
        )
        assert not c.execute("PRAGMA foreign_key_check").fetchall()
    assert apply_migrations(path) == (MIGRATIONS[-1].migration_id, False)


def test_unclaimed_legacy_content_is_never_silently_discarded():
    c = legacy_database()
    c.execute(
        "INSERT INTO thought_knowledge_bases(id,workspace_id,title,created_at,updated_at) "
        "VALUES ('legacy','default','Unclaimed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"
    )
    c.commit()
    with pytest.raises(sqlite3.IntegrityError):
        c.executescript(
            next(m.sql for m in MIGRATIONS if m.migration_id == "0116_account_ownership")
        )
    assert c.execute("SELECT title FROM thought_knowledge_bases WHERE id='legacy'").fetchone() == (
        "Unclaimed",
    )
    c.close()


async def test_storage_journal_verifies_other_accounts_assets_and_resumes(tmp_path):
    from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

    from app.capabilities.asset_store.account_upgrade import migrate_accounts
    from app.capabilities.asset_store.models import VisualAsset
    from app.capabilities.asset_store.upgrade_records import AccountStorageUpgradeRoot
    from app.orm import bind_owner
    from db.migrations import apply_migrations

    path = tmp_path / "storage-upgrade.db"
    apply_migrations(path)
    engine = create_async_engine("sqlite+aiosqlite:///" + str(path))
    settings = Settings(fpl_database_path=str(path))
    try:
        async with AsyncSession(engine, expire_on_commit=False) as session:
            session.add(
                User(
                    id="alice",
                    username="alice",
                    username_normalized="alice",
                    password_hash="unused",
                )
            )
            await session.flush()
            session.add(
                AccountStorageUpgradeRoot(
                    id="root",
                    owner_user_id="alice",
                    source_relative_root="old",
                    target_relative_root="accounts/alice",
                )
            )
            asset = VisualAsset(
                owner_user_id="alice",
                storage_key="payload",
                storage_version=2,
                original_filename="file.txt",
                display_name="file",
                media_kind="document",
                mime_type="text/plain",
                byte_size=4,
            )
            session.add(asset)
            await session.commit()
            # A bound admin session cannot suppress validation of another owner.
            bind_owner(session, "administrator")
            target = AssetStorage(settings).path_for(asset)
            state = await migrate_accounts(session, settings)
            assert state["failed"] == state["pending"] == 1
            target.parent.mkdir(parents=True)
            target.write_bytes(b"file")
            state = await migrate_accounts(session, settings)
            assert state["pending"] == 0
    finally:
        await engine.dispose()


async def test_shared_template_can_target_one_account_without_disclosing_private_catalog():
    from app.console.governance.model_template_sync import ModelTemplateSyncRunner

    admin, _ = await account_client(admin=True)
    owner, owner_id = await account_client()
    other, other_id = await account_client()
    endpoint = "/v1/platform/model-service-templates/user"
    async with aclosing(admin), aclosing(owner), aclosing(other):
        before = (await admin.get(endpoint)).json()
        catalog = (await owner.get("/v1/model-providers")).json()
        private_name = "Private connection " + uuid4().hex
        created = await owner.post(
            "/v1/model-providers",
            json={
                "name": private_name,
                "kind": "openai",
                "expected_catalog_revision": catalog["revision"],
            },
        )
        assert created.status_code == 200, created.text
        try:
            saved = await admin.put(
                endpoint,
                json={
                    "expected_revision": before["revision"],
                    "value": {
                        "providers": [],
                        "suppliers": [{"template_key": "targeted", "name": "Shared allocation"}],
                    },
                },
            )
            assert saved.status_code == 200, saved.text
            preview = await admin.post(
                endpoint + "/preview",
                json={
                    "expected_template_revision": saved.json()["revision"],
                    "account_ids": [owner_id],
                },
            )
            assert preview.status_code == 201, preview.text
            job = preview.json()
            assert [item["owner_user_id"] for item in job["items"]] == [owner_id]
            assert private_name not in preview.text and other_id not in preview.text
            started = await admin.post(
                "/v1/platform/model-service-templates/sync-jobs/" + job["id"] + "/start",
                json={"expected_revision": job["revision"]},
            )
            assert started.status_code == 200, started.text
            await ModelTemplateSyncRunner().process_once()
            await ModelTemplateSyncRunner().process_once()
            own = (await owner.get("/v1/model-providers")).json()
            foreign = (await other.get("/v1/model-providers")).json()
            assert any(item["name"] == "Shared allocation" for item in own["suppliers"])
            assert not any(item["name"] == "Shared allocation" for item in foreign["suppliers"])
            assert any(item["name"] == private_name for item in own["providers"])
        finally:
            latest = (await admin.get(endpoint)).json()
            restored = await admin.put(
                endpoint, json={"expected_revision": latest["revision"], "value": before["value"]}
            )
            assert restored.status_code == 200, restored.text
