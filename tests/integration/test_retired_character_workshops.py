"""Retirement preserves other account data and removes all character workshop schemas."""

from pathlib import Path
from unittest.mock import patch

import httpx
import pytest

from db.migrations import apply_migrations, runner
from db.migrations.registry import MIGRATIONS
from db.migrations.runner import connect_database
from website_test_support import app

RETIRED = {
    "live2d_projects",
    "live2d_assets",
    "live2d_exports",
    "live2d_cubism_attachments",
    "desktop_pet_projects",
    "desktop_pet_chats",
    "desktop_pet_chat_messages",
    "desktop_pet_chat_requests",
}


def test_retirement_upgrades_populated_accounts_without_touching_other_data(tmp_path: Path):
    database = tmp_path / "retirement.db"
    retirement_index = next(
        i
        for i, migration in enumerate(MIGRATIONS)
        if migration.migration_id == "0118_retire_character_workshops"
    )
    prefix = MIGRATIONS[:retirement_index]
    with (
        patch.object(runner, "MIGRATIONS", prefix),
        patch.object(runner, "LATEST_MIGRATION_ID", prefix[-1].migration_id),
    ):
        apply_migrations(database)
    with connect_database(database) as connection:
        for owner in ("first", "second"):
            connection.execute(
                "INSERT INTO users (id, username, username_normalized, password_hash, "
                "created_at, updated_at) VALUES (?,?,?,'unused','2026-11-02','2026-11-02')",
                (owner, owner, owner),
            )
            connection.execute(
                "INSERT INTO live2d_projects "
                "(id, owner_user_id, title, document, created_at, updated_at) "
                "VALUES (?,?,'retired','{}','2026-11-02','2026-11-02')",
                (owner, owner),
            )
            connection.execute(
                "INSERT INTO desktop_pet_projects "
                "(id, owner_user_id, source_project_id, source_revision, source_title, title, "
                "character, config, created_at, updated_at) "
                "VALUES (?,?,?,0,'retired','retired','{}','{}','2026-11-02','2026-11-02')",
                (owner, owner, owner),
            )
            connection.execute(
                "INSERT INTO desktop_pet_chats (id, owner_user_id, project_id, user_id, "
                "created_at, updated_at) VALUES (?,?,?,?,'2026-11-02','2026-11-02')",
                (owner, owner, owner, owner),
            )
            connection.execute(
                "INSERT INTO desktop_pet_chat_messages "
                "(id,chat_id,position,role,content,status,created_at,updated_at) "
                "VALUES (?,?,0,'user','private','done','2026-11-02','2026-11-02')",
                (owner, owner),
            )
            connection.execute(
                "INSERT INTO desktop_pet_chat_requests (chat_id,request_id,created_at) "
                "VALUES (?,'request','2026-11-02')",
                (owner,),
            )
        connection.commit()
        tables_before = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        users_before = connection.execute("SELECT * FROM users ORDER BY id").fetchall()
        history_before = connection.execute(
            "SELECT * FROM schema_migrations ORDER BY rowid"
        ).fetchall()
    target = MIGRATIONS[: retirement_index + 1]
    with (
        patch.object(runner, "MIGRATIONS", target),
        patch.object(runner, "LATEST_MIGRATION_ID", target[-1].migration_id),
    ):
        assert apply_migrations(database) == (target[-1].migration_id, True)
        assert apply_migrations(database) == (target[-1].migration_id, False)
    with connect_database(database) as connection:
        tables_after = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        assert tables_before - tables_after == RETIRED
        assert tables_after - tables_before == set()
        assert connection.execute("SELECT * FROM users ORDER BY id").fetchall() == users_before
        assert (
            connection.execute("SELECT * FROM schema_migrations ORDER BY rowid").fetchall()[:-1]
            == history_before
        )
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)


@pytest.mark.asyncio
async def test_retired_http_operations_return_not_found():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        for feature in ("live2d-workshop", "desktop-pet"):
            for method, suffix in (("GET", ""), ("POST", ""), ("DELETE", "/old")):
                response = await client.request(method, f"/v1/{feature}/projects{suffix}")
                assert response.status_code == 404
