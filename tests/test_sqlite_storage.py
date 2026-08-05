from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import Request
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

import app.main as main_module
from app.problem_details import storage_operational_error_handler
from db.migrations import MigrationDriftError, apply_migrations, check_migrations
from db.migrations.registry import MIGRATIONS
from db.migrations.runner import connect_database, ensure_registry, migration_checksum

DEFAULT_OPENAI_PROVIDER_ID = "f0000000-0000-4000-8000-000000000001"


def _create_database_at_migration(database_path: Path, migration_count: int) -> None:
    with connect_database(database_path) as connection:
        ensure_registry(connection)
        for migration in MIGRATIONS[:migration_count]:
            if migration.foreign_keys_off:
                connection.execute("PRAGMA foreign_keys = OFF")
            connection.executescript(migration.sql)
            connection.execute(
                "INSERT INTO schema_migrations (migration_id, checksum) VALUES (?, ?)",
                (migration.migration_id, migration_checksum(migration)),
            )
            connection.commit()
            if migration.foreign_keys_off:
                connection.execute("PRAGMA foreign_keys = ON")


def test_sqlite_migration_is_repeatable_and_detects_drift(tmp_path: Path) -> None:
    database_path = tmp_path / "nested" / "catalog.db"

    assert apply_migrations(database_path) == (
        "r0017_galgame_character_assets",
        True,
    )
    assert apply_migrations(database_path) == (
        "r0017_galgame_character_assets",
        False,
    )
    assert check_migrations(database_path) == "r0017_galgame_character_assets"

    with connect_database(database_path) as connection:
        connection.execute(
            "UPDATE schema_migrations SET checksum = 'changed' WHERE migration_id = ?",
            ("r0001_initial",),
        )
        connection.commit()

    with pytest.raises(MigrationDriftError):
        check_migrations(database_path)


def test_existing_r0001_database_upgrades_without_rewriting_history(tmp_path: Path) -> None:
    database_path = tmp_path / "upgrade.db"
    initial = MIGRATIONS[0]
    with connect_database(database_path) as connection:
        ensure_registry(connection)
        connection.executescript(initial.sql)
        connection.execute(
            "INSERT INTO schema_migrations (migration_id, checksum) VALUES (?, ?)",
            (initial.migration_id, migration_checksum(initial)),
        )
        connection.commit()

    assert apply_migrations(database_path) == (
        "r0017_galgame_character_assets",
        True,
    )
    with connect_database(database_path) as connection:
        migrations = connection.execute(
            "SELECT migration_id FROM schema_migrations ORDER BY migration_id"
        ).fetchall()
        assert migrations == [
            ("r0001_initial",),
            ("r0002_model_test_conversations",),
            ("r0003_tool_navigation_state",),
            ("r0004_expand_senseaudio_text_catalog",),
            ("r0005_visual_workshop_projects",),
            ("r0006_file_management",),
            ("r0007_model_test_attachments",),
            ("r0008_visual_generation",),
            ("r0009_visual_canvas_documents",),
            ("r0010_model_categories_and_test_generation",),
            ("r0011_visual_assistant_conversations",),
            ("r0012_visual_assistant_actions",),
            ("r0013_visual_assistant_generation_models",),
            ("r0014_visual_assistant_content_parts",),
            ("r0015_model_test_generation_assets",),
            ("r0016_galgame_workshop_projects",),
            ("r0017_galgame_character_assets",),
        ]
        assert connection.execute("SELECT COUNT(*) FROM model_test_conversations").fetchone() == (
            0,
        )
        assert connection.execute("SELECT COUNT(*) FROM tool_navigation_items").fetchone() == (0,)
        assert connection.execute("SELECT COUNT(*) FROM visual_workshop_projects").fetchone() == (
            0,
        )
        assert connection.execute("SELECT COUNT(*) FROM galgame_workshop_projects").fetchone() == (
            0,
        )
        assert connection.execute("SELECT COUNT(*) FROM galgame_story_documents").fetchone() == (0,)
        conversation_columns = {
            row[1]
            for row in connection.execute(
                "PRAGMA table_info(visual_assistant_conversations)"
            ).fetchall()
        }
        assert {"image_model_id", "video_model_id"} <= conversation_columns
        conversation_indexes = {
            row[1]
            for row in connection.execute(
                "PRAGMA index_list(visual_assistant_conversations)"
            ).fetchall()
        }
        assert {
            "ix_visual_assistant_conversations_image_model",
            "ix_visual_assistant_conversations_video_model",
        } <= conversation_indexes
        generation_asset_columns = {
            row[1]
            for row in connection.execute(
                "PRAGMA table_info(model_test_generation_assets)"
            ).fetchall()
        }
        assert {
            "task_id",
            "role",
            "position",
            "storage_key",
            "legacy_visual_asset_id",
        } <= generation_asset_columns


def test_r0014_adds_empty_content_parts_to_existing_messages(tmp_path: Path) -> None:
    database_path = tmp_path / "assistant-content-parts-upgrade.db"
    with connect_database(database_path) as connection:
        connection.executescript(
            """
            CREATE TABLE visual_assistant_messages (
              id VARCHAR(36) PRIMARY KEY,
              content TEXT NOT NULL DEFAULT ''
            );
            """
        )
        connection.execute(
            "INSERT INTO visual_assistant_messages (id, content) VALUES (?, ?)",
            ("message-1", "旧消息"),
        )
        migration = next(
            item
            for item in MIGRATIONS
            if item.migration_id == "r0014_visual_assistant_content_parts"
        )
        connection.executescript(migration.sql)
        connection.commit()
        columns = {
            row[1]
            for row in connection.execute("PRAGMA table_info(visual_assistant_messages)").fetchall()
        }
        stored = connection.execute(
            "SELECT content, content_parts FROM visual_assistant_messages WHERE id = ?",
            ("message-1",),
        ).fetchone()

    assert "content_parts" in columns
    assert stored == ("旧消息", "[]")


def test_r0015_upgrades_r0014_and_enforces_private_asset_ownership(tmp_path: Path) -> None:
    database_path = tmp_path / "generation-assets-upgrade.db"
    _create_database_at_migration(database_path, len(MIGRATIONS) - 1)
    with connect_database(database_path) as connection:
        connection.execute(
            """
            INSERT INTO model_test_generation_tasks (
              id, provider_kind, generation_kind, provider_name, model_slug,
              request_payload, status, progress, revision, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            (
                "legacy-task",
                "senseaudio_video",
                "video",
                "legacy",
                "legacy-video",
                '{"video_asset_ids":["public-asset"]}',
                "failed",
                0,
                0,
            ),
        )
        connection.commit()

    assert apply_migrations(database_path) == (
        "r0017_galgame_character_assets",
        True,
    )
    assert apply_migrations(database_path) == (
        "r0017_galgame_character_assets",
        False,
    )
    with connect_database(database_path) as connection:
        assert connection.execute(
            "SELECT request_payload FROM model_test_generation_tasks WHERE id = 'legacy-task'"
        ).fetchone() == ('{"video_asset_ids":["public-asset"]}',)
        indexes = {
            row[1]
            for row in connection.execute(
                "PRAGMA index_list(model_test_generation_assets)"
            ).fetchall()
        }
        assert {
            "ix_model_test_generation_assets_task",
            "ix_model_test_generation_assets_draft_created",
        } <= indexes
        connection.execute(
            """
            INSERT INTO model_test_generation_assets (
              id, task_id, role, position, original_filename, storage_key,
              media_kind, mime_type, byte_size
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "private-asset",
                "legacy-task",
                "reference_video",
                0,
                "legacy.mp4",
                "private-key",
                "video",
                "video/mp4",
                1,
            ),
        )
        connection.execute("DELETE FROM model_test_generation_tasks WHERE id = 'legacy-task'")
        connection.commit()
        assert connection.execute(
            "SELECT COUNT(*) FROM model_test_generation_assets WHERE id = 'private-asset'"
        ).fetchone() == (0,)


def test_existing_default_catalog_is_extended_without_overwriting_user_data(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "catalog-upgrade.db"
    _create_database_at_migration(database_path, 3)

    with connect_database(database_path) as connection:
        connection.execute(
            """
            INSERT INTO model_providers (
              id, name, kind, base_url, api_key_ciphertext, enabled, sort_order
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                DEFAULT_OPENAI_PROVIDER_ID,
                "用户修改的网关",
                "openai",
                "https://custom.example/v1",
                "encrypted-user-key",
                False,
                6,
            ),
        )
        connection.executemany(
            """
            INSERT INTO model_entries (
              id, provider_id, slug, label, description, capabilities, enabled, sort_order
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    "f1000000-0000-4000-8000-000000000001",
                    DEFAULT_OPENAI_PROVIDER_ID,
                    "senseaudio-s2-lite",
                    "用户修改的 S2 Lite",
                    "用户保留的描述",
                    json.dumps(["chat"]),
                    False,
                    4,
                ),
                (
                    "f1000000-0000-4000-8000-000000000003",
                    DEFAULT_OPENAI_PROVIDER_ID,
                    "deepseek-v4-pro",
                    "DeepSeek V4 Pro",
                    "旗舰文本生成与工具调用模型",
                    json.dumps(["chat", "tools"]),
                    True,
                    5,
                ),
                (
                    str(uuid4()),
                    DEFAULT_OPENAI_PROVIDER_ID,
                    "qwen3.6-27b",
                    "用户手工添加的 Qwen",
                    "不应被迁移覆盖",
                    json.dumps(["chat"]),
                    False,
                    9,
                ),
            ],
        )
        connection.execute("UPDATE model_catalog_state SET revision = 7 WHERE id = 'default'")
        connection.commit()

    assert apply_migrations(database_path) == (
        "r0017_galgame_character_assets",
        True,
    )

    with connect_database(database_path) as connection:
        provider = connection.execute(
            """
            SELECT name, base_url, api_key_ciphertext, enabled, sort_order
            FROM model_providers WHERE id = ?
            """,
            (DEFAULT_OPENAI_PROVIDER_ID,),
        ).fetchone()
        preserved_models = connection.execute(
            """
            SELECT slug, label, description, capabilities, enabled, sort_order
            FROM model_entries
            WHERE provider_id = ? AND slug IN ('senseaudio-s2-lite', 'qwen3.6-27b')
            ORDER BY slug
            """,
            (DEFAULT_OPENAI_PROVIDER_ID,),
        ).fetchall()
        appended = connection.execute(
            """
            SELECT slug, sort_order
            FROM model_entries
            WHERE provider_id = ? AND sort_order > 9
            ORDER BY sort_order
            """,
            (DEFAULT_OPENAI_PROVIDER_ID,),
        ).fetchall()
        all_slugs = {
            row[0]
            for row in connection.execute(
                "SELECT slug FROM model_entries WHERE provider_id = ?",
                (DEFAULT_OPENAI_PROVIDER_ID,),
            ).fetchall()
        }
        revision = connection.execute(
            "SELECT revision FROM model_catalog_state WHERE id = 'default'"
        ).fetchone()
        stored_categories = {
            row[0] for row in connection.execute("SELECT categories FROM model_entries").fetchall()
        }

    assert provider == (
        "用户修改的网关",
        "https://custom.example/v1",
        "encrypted-user-key",
        0,
        6,
    )
    assert preserved_models == [
        (
            "qwen3.6-27b",
            "用户手工添加的 Qwen",
            "不应被迁移覆盖",
            '["chat"]',
            0,
            9,
        ),
        (
            "senseaudio-s2-lite",
            "用户修改的 S2 Lite",
            "用户保留的描述",
            '["chat"]',
            0,
            4,
        ),
    ]
    assert [row[0] for row in appended] == [
        "senseaudio-s2",
        "senseaudio-s2-flash",
        "senseaudio-s1",
        "senseaudio-vl-lite-1.0-260319",
        "sensenova-6.7-flash-lite",
        "deepseek-v4-flash",
        "qwen3.6-35b-a3b",
        "kimi-k2.6",
        "glm-5.1",
        "glm-5.2",
        "minimax-m2.7",
        "doubao-seed-2-0-pro-260215",
    ]
    assert "senseaudio-vl-1.0-260319" not in all_slugs
    assert len(all_slugs) == 15
    assert revision == (9,)
    assert stored_categories == {"[]"}

    assert apply_migrations(database_path) == (
        "r0017_galgame_character_assets",
        False,
    )
    with connect_database(database_path) as connection:
        assert connection.execute(
            "SELECT revision FROM model_catalog_state WHERE id = 'default'"
        ).fetchone() == (9,)
        assert connection.execute("SELECT COUNT(*) FROM model_entries").fetchone() == (20,)


def test_catalog_upgrade_does_not_recreate_deleted_default_provider(tmp_path: Path) -> None:
    database_path = tmp_path / "deleted-provider.db"
    _create_database_at_migration(database_path, 3)
    with connect_database(database_path) as connection:
        connection.execute("UPDATE model_catalog_state SET revision = 4 WHERE id = 'default'")
        connection.commit()

    assert apply_migrations(database_path) == (
        "r0017_galgame_character_assets",
        True,
    )
    with connect_database(database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM model_providers").fetchone() == (0,)
        assert connection.execute("SELECT COUNT(*) FROM model_entries").fetchone() == (0,)
        assert connection.execute(
            "SELECT revision FROM model_catalog_state WHERE id = 'default'"
        ).fetchone() == (4,)


def test_r0007_upgrade_adds_visual_tasks_and_preserves_provider_credentials(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "r0007-upgrade.db"
    _create_database_at_migration(database_path, 7)
    with connect_database(database_path) as connection:
        connection.execute(
            """
            INSERT INTO model_providers (
              id, name, kind, base_url, api_key_ciphertext, enabled, sort_order
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                DEFAULT_OPENAI_PROVIDER_ID,
                "用户网关",
                "openai",
                "https://custom.example/v1",
                "encrypted-user-key",
                True,
                9,
            ),
        )
        connection.commit()

    assert apply_migrations(database_path) == (
        "r0017_galgame_character_assets",
        True,
    )
    with connect_database(database_path) as connection:
        preserved = connection.execute(
            """
            SELECT name, kind, base_url, api_key_ciphertext, enabled, sort_order
            FROM model_providers WHERE id = ?
            """,
            (DEFAULT_OPENAI_PROVIDER_ID,),
        ).fetchone()
        visual_providers = connection.execute(
            """
            SELECT kind, base_url, api_key_ciphertext, enabled
            FROM model_providers
            WHERE kind IN ('senseaudio_image', 'senseaudio_video')
            ORDER BY kind
            """
        ).fetchall()
        task_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(visual_generation_tasks)")
        }
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "INSERT INTO model_providers (id, name, kind) VALUES (?, ?, ?)",
                (str(uuid4()), "无效供应商", "unsupported"),
            )

    assert preserved == (
        "用户网关",
        "openai",
        "https://custom.example/v1",
        "encrypted-user-key",
        1,
        9,
    )
    assert visual_providers == [
        ("senseaudio_image", "https://api.senseaudio.cn/v1", "", 0),
        ("senseaudio_video", "https://api.senseaudio.cn/v1", "", 0),
    ]
    assert {
        "project_id",
        "provider_kind",
        "generation_kind",
        "request_payload",
        "provider_task_id",
        "result_asset_id",
    } <= task_columns


def test_sqlite_pragmas_json_and_foreign_key_cascade(tmp_path: Path) -> None:
    database_path = tmp_path / "storage.db"
    apply_migrations(database_path)
    provider_id = str(uuid4())
    model_id = str(uuid4())

    with connect_database(database_path) as connection:
        assert connection.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        assert connection.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
        assert connection.execute("PRAGMA busy_timeout").fetchone()[0] == 5000
        connection.execute(
            "INSERT INTO model_providers (id, name, kind) VALUES (?, ?, ?)",
            (provider_id, "测试供应商", "openai"),
        )
        connection.execute(
            """
            INSERT INTO model_entries (id, provider_id, slug, capabilities)
            VALUES (?, ?, ?, ?)
            """,
            (model_id, provider_id, "model-test", json.dumps(["chat", "tools"])),
        )
        stored = connection.execute(
            "SELECT json_extract(capabilities, '$[1]') FROM model_entries WHERE id = ?",
            (model_id,),
        ).fetchone()
        assert stored == ("tools",)
        connection.execute("DELETE FROM model_providers WHERE id = ?", (provider_id,))
        assert connection.execute(
            "SELECT COUNT(*) FROM model_entries WHERE id = ?", (model_id,)
        ).fetchone() == (0,)


@pytest.mark.asyncio
async def test_async_database_connections_enable_sqlite_pragmas() -> None:
    async with main_module.engine.connect() as connection:
        foreign_keys = (await connection.execute(text("PRAGMA foreign_keys"))).scalar_one()
        journal_mode = (await connection.execute(text("PRAGMA journal_mode"))).scalar_one()
        busy_timeout = (await connection.execute(text("PRAGMA busy_timeout"))).scalar_one()

    assert foreign_keys == 1
    assert str(journal_mode).lower() == "wal"
    assert busy_timeout == 5000


@pytest.mark.asyncio
async def test_lifespan_applies_migrations_and_disposes_engine(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    migrated: list[Path] = []
    seeded: list[object] = []
    disposed: list[bool] = []

    monkeypatch.setattr(main_module, "apply_migrations", migrated.append)

    async def fake_seed(session: object) -> bool:
        seeded.append(session)
        return True

    monkeypatch.setattr(main_module, "seed_sayflow_text_catalog", fake_seed)

    async def fake_dispose() -> None:
        disposed.append(True)

    monkeypatch.setattr(main_module, "engine", SimpleNamespace(dispose=fake_dispose))
    async with main_module.lifespan(main_module.app):
        pass

    assert migrated == [main_module.settings.database_path]
    assert len(seeded) == 1
    assert disposed == [True]


@pytest.mark.asyncio
async def test_locked_database_returns_retryable_problem() -> None:
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/v1/model-providers",
            "headers": [],
        }
    )
    error = OperationalError(
        "INSERT INTO model_providers (...) VALUES (...)",
        {},
        sqlite3.OperationalError("database is locked"),
    )

    response = await storage_operational_error_handler(request, error)
    body = json.loads(response.body)

    assert response.status_code == 503
    assert response.headers["retry-after"] == "1"
    assert body["code"] == "storage_busy"
