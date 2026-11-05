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
from tests.migration_fixtures import LATEST_MIGRATION_ID, MIGRATIONS, apply_migrations

import studio.assembly.website.lifecycle as main_module
import website_test_support as database_module
from db.migrations.runner import connect_database, ensure_registry, migration_checksum
from studio.runtime.http.problem_details import storage_operational_error_handler

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


def _migration_count_before(migration_id: str) -> int:
    return next(
        index
        for index, migration in enumerate(MIGRATIONS)
        if migration.migration_id == migration_id
    )


def test_r0069_retires_unsupported_models_and_remaps_defaults(tmp_path: Path) -> None:
    database_path = tmp_path / "r0069-retire.db"
    _create_database_at_migration(
        database_path,
        _migration_count_before("r0069_retire_unsupported_senseaudio_models"),
    )
    old_model_id = "retire-old-6-7"
    new_model_id = "retire-new-6-8"
    keep_model_id = "retire-keep-s2"
    conversation_id = "retire-conversation"
    with connect_database(database_path) as connection:
        connection.execute(
            """
            INSERT INTO model_providers (
              id, workspace_id, name, kind, base_url, api_key_ciphertext, enabled, sort_order
            ) VALUES (?, 'default', 'OpenAI 兼容网关', 'openai',
                      'https://api.senseaudio.cn/v1', '', 1, 0)
            ON CONFLICT(id) DO NOTHING
            """,
            (DEFAULT_OPENAI_PROVIDER_ID,),
        )
        connection.execute(
            """
            DELETE FROM model_entries
            WHERE provider_id = ?
              AND slug IN (
                'sensenova-6.7-flash-lite',
                'sensenova-6.8-flash-lite',
                'senseaudio-s2'
              )
            """,
            (DEFAULT_OPENAI_PROVIDER_ID,),
        )
        connection.executemany(
            """
            INSERT INTO model_entries (
              id, workspace_id, provider_id, slug, label, description,
              capabilities, categories, enabled, sort_order
            ) VALUES (?, 'default', ?, ?, ?, '', '["chat","tools"]', '["text_generation"]', 1, ?)
            """,
            [
                (
                    old_model_id,
                    DEFAULT_OPENAI_PROVIDER_ID,
                    "sensenova-6.7-flash-lite",
                    "SenseNova 6.7 Flash-Lite",
                    20,
                ),
                (
                    new_model_id,
                    DEFAULT_OPENAI_PROVIDER_ID,
                    "sensenova-6.8-flash-lite",
                    "SenseNova 6.8 Flash-Lite",
                    21,
                ),
                (
                    keep_model_id,
                    DEFAULT_OPENAI_PROVIDER_ID,
                    "senseaudio-s2",
                    "SenseAudio S2",
                    0,
                ),
            ],
        )
        connection.execute(
            """
            INSERT INTO platform_settings (id, payload, revision)
            VALUES ('workspace_defaults:default', ?, 1)
            ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, revision = 1
            """,
            (json.dumps({"chat": old_model_id, "tools": keep_model_id}),),
        )
        connection.execute(
            """
            INSERT INTO model_test_conversations (id, workspace_id, title, model_id)
            VALUES (?, 'default', '旧模型对话', ?)
            """,
            (conversation_id, old_model_id),
        )
        before_revision = connection.execute(
            "SELECT revision FROM model_catalog_state WHERE id = 'default'"
        ).fetchone()[0]
        connection.commit()

    assert apply_migrations(database_path) == (LATEST_MIGRATION_ID, True)
    with connect_database(database_path) as connection:
        assert connection.execute(
            """
            SELECT COUNT(*) FROM model_entries
            WHERE slug IN (
              'sensenova-6.7-flash-lite',
              'deepseek-v4-flash',
              'deepseek-v4-pro',
              'qwen3.6-27b',
              'glm-5.1',
              'senseaudio-image-1.0-260319'
            )
            """
        ).fetchone() == (0,)
        assert connection.execute(
            "SELECT 1 FROM model_entries WHERE id = ?",
            (new_model_id,),
        ).fetchone() == (1,)
        payload = json.loads(
            connection.execute(
                "SELECT payload FROM platform_settings WHERE id = 'workspace_defaults:default'"
            ).fetchone()[0]
        )
        assert payload == {"chat": new_model_id, "tools": keep_model_id}
        assert connection.execute(
            "SELECT revision FROM platform_settings WHERE id = 'workspace_defaults:default'"
        ).fetchone() == (2,)
        assert connection.execute(
            "SELECT model_id FROM model_test_conversations WHERE id = ?",
            (conversation_id,),
        ).fetchone() == (None,)
        assert connection.execute(
            "SELECT revision FROM model_catalog_state WHERE id = 'default'"
        ).fetchone() == (before_revision + 1,)


def test_catalog_upgrade_does_not_recreate_deleted_default_provider(tmp_path: Path) -> None:
    database_path = tmp_path / "deleted-provider.db"
    _create_database_at_migration(database_path, 3)
    with connect_database(database_path) as connection:
        connection.execute("UPDATE model_catalog_state SET revision = 4 WHERE id = 'default'")
        connection.commit()

    assert apply_migrations(database_path) == (
        LATEST_MIGRATION_ID,
        True,
    )
    with connect_database(database_path) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM model_providers WHERE kind = 'openai'"
        ).fetchone() == (0,)
        assert connection.execute(
            "SELECT COUNT(*) FROM model_providers WHERE kind = 'senseaudio_asr'"
        ).fetchone() == (1,)
        assert connection.execute(
            "SELECT COUNT(*) FROM model_providers WHERE kind = 'senseaudio_asr_pro'"
        ).fetchone() == (1,)
        assert connection.execute("SELECT COUNT(*) FROM model_entries").fetchone() == (6,)
        assert connection.execute(
            "SELECT COUNT(*) FROM model_providers WHERE kind = 'senseaudio_realtime'"
        ).fetchone() == (1,)
        assert connection.execute(
            "SELECT revision FROM model_catalog_state WHERE id = 'default'"
        ).fetchone() == (10,)
        assert connection.execute(
            """
            SELECT slug FROM model_entries
            WHERE provider_id = 'f0000000-0000-4000-8000-000000000008'
            ORDER BY slug
            """
        ).fetchall() == [
            ("senseaudio-music-1.0-260319",),
            ("senseaudio-music-2.0-260626",),
        ]


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
        LATEST_MIGRATION_ID,
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


def test_r0024_adds_private_model_test_transcription_tasks(tmp_path: Path) -> None:
    database_path = tmp_path / "r0023-transcription-upgrade.db"
    _create_database_at_migration(
        database_path, _migration_count_before("r0024_model_test_transcription")
    )

    assert apply_migrations(database_path) == (
        LATEST_MIGRATION_ID,
        True,
    )
    with connect_database(database_path) as connection:
        columns = {
            row[1]
            for row in connection.execute("PRAGMA table_info(model_test_transcription_tasks)")
        }
        foreign_keys = {
            (row[3], row[2], row[4], row[6])
            for row in connection.execute("PRAGMA foreign_key_list(model_test_transcription_tasks)")
        }
        indexes = {
            row[1]
            for row in connection.execute("PRAGMA index_list(model_test_transcription_tasks)")
        }

    assert {
        "workspace_id",
        "provider_kind",
        "source_asset_id",
        "input_storage_key",
        "language",
        "result_text",
        "result_segments",
        "log_id",
        "revision",
        "started_at",
        "completed_at",
    } <= columns
    assert ("workspace_id", "workspaces", "id", "CASCADE") in foreign_keys
    assert ("source_asset_id", "visual_assets", "id", "SET NULL") in foreign_keys
    assert "ix_model_test_transcription_workspace_created" in indexes


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
    async with database_module.engine.connect() as connection:
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
    from studio.assembly.website.application import create_app

    migrated: list[Path] = []
    disposed: list[bool] = []
    application = create_app(database_module.settings)
    database = application.state.database
    dispose = database.engine.dispose
    monkeypatch.setattr(main_module, "apply_migrations", migrated.append)

    async def fake_dispose() -> None:
        disposed.append(True)
        await dispose()

    monkeypatch.setattr(
        database,
        "engine",
        SimpleNamespace(connect=database.engine.connect, dispose=fake_dispose),
    )
    async with main_module.lifespan(application):
        pass

    assert migrated == [database_module.settings.database_path]
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
