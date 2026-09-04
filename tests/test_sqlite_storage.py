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
from db.migrations.registry import LATEST_MIGRATION_ID, MIGRATIONS
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


def _migration_count_before(migration_id: str) -> int:
    return next(
        index
        for index, migration in enumerate(MIGRATIONS)
        if migration.migration_id == migration_id
    )


def test_sqlite_migration_is_repeatable_and_detects_drift(tmp_path: Path) -> None:
    database_path = tmp_path / "nested" / "catalog.db"

    assert apply_migrations(database_path) == (
        LATEST_MIGRATION_ID,
        True,
    )
    assert apply_migrations(database_path) == (
        LATEST_MIGRATION_ID,
        False,
    )
    assert check_migrations(database_path) == LATEST_MIGRATION_ID

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
        LATEST_MIGRATION_ID,
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
            ("r0018_galgame_asset_management",),
            ("r0019_project_storage_layout",),
            ("r0020_accounts_and_workspaces",),
            ("r0021_senseaudio_asr",),
            ("r0022_audio_annotation",),
            ("r0023_senseaudio_asr_fresh_catalog",),
            ("r0024_model_test_transcription",),
            ("r0025_pro_asr_provider",),
            ("r0026_transcription_100mb",),
            ("r0027_transcription_parameters",),
            ("r0028_galgame_annotation_imports",),
            ("r0029_galgame_video_exports",),
            ("r0030_senseaudio_realtime",),
            ("r0031_integration_center",),
            ("r0032_realtime_fresh_catalog",),
            ("r0033_model_test_tools",),
            ("r0034_realtime_tool_calls",),
            ("r0035_video_editor",),
            ("r0036_galgame_video_editor_handoffs",),
            ("r0037_media_workshop_upgrade",),
            ("r0038_media_workshop_tasks_and_audio",),
            ("r0039_visual_generation_node_history",),
            ("r0040_video_editor_mixed_tracks",),
            ("r0041_visual_generation_batches",),
            ("r0042_image_compositions",),
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


def test_r0020_assigns_complete_r0019_history_to_default_workspace(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "r0019-history.db"
    _create_database_at_migration(
        database_path, _migration_count_before("r0020_accounts_and_workspaces")
    )
    with connect_database(database_path) as connection:
        connection.execute(
            """
            INSERT INTO model_providers (
              id, name, kind, base_url, api_key_ciphertext, enabled
            ) VALUES ('provider-history', '历史网关', 'openai', '', 'encrypted-history', 1)
            """
        )
        connection.execute(
            """
            INSERT INTO llm_call_logs (
              id, call_source, provider_kind, model, trace_id,
              request_payload, response_payload, status
            ) VALUES (
              'log-history', 'model_diagnostic', 'openai', 'history-model',
              'trace-history', '{"prompt":"保留"}', '{"answer":"保留"}', 'success'
            )
            """
        )
        connection.execute(
            """
            INSERT INTO visual_workshop_projects (id, title, kind)
            VALUES ('visual-history', '历史视觉项目', 'canvas')
            """
        )
        connection.execute(
            """
            INSERT INTO galgame_workshop_projects (id, title)
            VALUES ('galgame-history', '历史 Galgame')
            """
        )
        connection.execute(
            """
            INSERT INTO visual_asset_folders (id, name)
            VALUES ('folder-history', '历史文件夹')
            """
        )
        connection.execute(
            """
            INSERT INTO visual_assets (
              id, folder_id, original_filename, display_name, storage_key,
              media_kind, mime_type, byte_size
            ) VALUES (
              'asset-history', 'folder-history', 'old.png', 'old.png',
              'legacy-storage-key', 'image', 'image/png', 128
            )
            """
        )
        connection.execute(
            """
            INSERT INTO model_test_conversations (id, title, system_prompt)
            VALUES ('conversation-history', '历史对话', '历史系统提示')
            """
        )
        connection.execute(
            """
            INSERT INTO tool_navigation_items (tool_id, is_favorite, use_count)
            VALUES ('json-formatter', 1, 7)
            """
        )
        connection.commit()

    assert apply_migrations(database_path) == (
        LATEST_MIGRATION_ID,
        True,
    )
    workspace_tables = (
        "model_providers",
        "model_entries",
        "llm_call_logs",
        "visual_workshop_projects",
        "visual_generation_tasks",
        "visual_assistant_conversations",
        "galgame_workshop_projects",
        "galgame_asset_transcription_tasks",
        "visual_asset_folders",
        "visual_assets",
        "visual_project_asset_references",
        "model_test_conversations",
        "model_test_generation_tasks",
        "model_test_generation_assets",
        "model_test_transcription_tasks",
        "tool_navigation_items",
    )
    with connect_database(database_path) as connection:
        for table in workspace_tables:
            columns = {
                row[1] for row in connection.execute(f"PRAGMA table_info({table})").fetchall()
            }
            assert "workspace_id" in columns
            assert connection.execute(
                f"SELECT COUNT(*) FROM {table} WHERE workspace_id != 'default'"
            ).fetchone() == (0,)
        assert connection.execute(
            "SELECT api_key_ciphertext FROM model_providers WHERE id = 'provider-history'"
        ).fetchone() == ("encrypted-history",)
        assert connection.execute(
            "SELECT request_payload, response_payload FROM llm_call_logs WHERE id = 'log-history'"
        ).fetchone() == ('{"prompt":"保留"}', '{"answer":"保留"}')
        assert connection.execute(
            "SELECT storage_key, storage_version FROM visual_assets WHERE id = 'asset-history'"
        ).fetchone() == ("legacy-storage-key", 1)
        assert connection.execute(
            "SELECT workspace_id, use_count FROM tool_navigation_items "
            "WHERE tool_id = 'json-formatter'"
        ).fetchone() == ("default", 7)
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


def test_r0021_adds_senseaudio_asr_to_each_existing_workspace(tmp_path: Path) -> None:
    database_path = tmp_path / "r0020-multi-workspace.db"
    _create_database_at_migration(database_path, _migration_count_before("r0021_senseaudio_asr"))
    workspace_id = "12345678-1234-5678-9abc-def012345678"
    with connect_database(database_path) as connection:
        connection.execute(
            "INSERT INTO workspaces (id, name) VALUES (?, ?)",
            (workspace_id, "第二工作区"),
        )
        connection.execute(
            "INSERT INTO model_catalog_state (id, revision) VALUES (?, 3)",
            (workspace_id,),
        )
        connection.execute("UPDATE model_catalog_state SET revision = 1 WHERE id = 'default'")
        default_revision = connection.execute(
            "SELECT revision FROM model_catalog_state WHERE id = 'default'"
        ).fetchone()[0]
        connection.commit()

    assert apply_migrations(database_path) == (
        LATEST_MIGRATION_ID,
        True,
    )
    with connect_database(database_path) as connection:
        providers = connection.execute(
            """
            SELECT workspace_id, id, base_url, api_key_ciphertext, enabled
            FROM model_providers
            WHERE kind = 'senseaudio_asr'
            ORDER BY CASE workspace_id WHEN 'default' THEN 0 ELSE 1 END,
                     sort_order
            """
        ).fetchall()
        models = connection.execute(
            """
            SELECT entry.workspace_id, entry.slug, entry.capabilities,
                   entry.categories, entry.enabled
            FROM model_entries AS entry
            JOIN model_providers AS provider ON provider.id = entry.provider_id
            WHERE provider.kind = 'senseaudio_asr'
            ORDER BY CASE entry.workspace_id WHEN 'default' THEN 0 ELSE 1 END,
                     provider.sort_order
            """
        ).fetchall()
        revisions = dict(connection.execute("SELECT id, revision FROM model_catalog_state"))
        metadata_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(galgame_asset_metadata)")
        }
        task_columns = {
            row[1]
            for row in connection.execute("PRAGMA table_info(galgame_asset_transcription_tasks)")
        }
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []

    assert len(providers) == 4
    assert len({row[1] for row in providers}) == 4
    assert all(len(row[1]) == 36 for row in providers)
    assert [(row[0], row[2], row[3], row[4]) for row in providers] == [
        ("default", "https://api.senseaudio.cn/v1", "", 0),
        ("default", "http://180.184.148.131:30002/api/v2/asr/pro", "", 0),
        (workspace_id, "https://api.senseaudio.cn/v1", "", 0),
        (workspace_id, "http://180.184.148.131:30002/api/v2/asr/pro", "", 0),
    ]
    assert models == [
        (
            "default",
            "senseaudio-asr-pro-1.5-260319",
            '["speech_recognition"]',
            '["speech_recognition"]',
            1,
        ),
        (
            "default",
            "pro-asr",
            '["speech_recognition"]',
            '["speech_recognition"]',
            1,
        ),
        (
            workspace_id,
            "senseaudio-asr-pro-1.5-260319",
            '["speech_recognition"]',
            '["speech_recognition"]',
            1,
        ),
        (
            workspace_id,
            "pro-asr",
            '["speech_recognition"]',
            '["speech_recognition"]',
            1,
        ),
    ]
    assert revisions["default"] == default_revision + 4
    assert revisions[workspace_id] == 7
    assert "transcript_segments" in metadata_columns
    assert "result_segments" in task_columns
    assert apply_migrations(database_path) == (
        LATEST_MIGRATION_ID,
        False,
    )


def test_r0030_adds_realtime_voice_and_clones_workspace_credentials(tmp_path: Path) -> None:
    database_path = tmp_path / "r0029-realtime-upgrade.db"
    _create_database_at_migration(
        database_path, _migration_count_before("r0030_senseaudio_realtime")
    )
    keyed_workspace = "12345678-1234-5678-9abc-def012345678"
    empty_workspace = "87654321-4321-4abc-8def-0123456789ab"
    with connect_database(database_path) as connection:
        connection.executemany(
            "INSERT INTO workspaces (id, name) VALUES (?, ?)",
            [(keyed_workspace, "有密钥"), (empty_workspace, "无密钥")],
        )
        connection.executemany(
            "INSERT INTO model_catalog_state (id, revision) VALUES (?, ?)",
            [(keyed_workspace, 7), (empty_workspace, 4)],
        )
        connection.execute(
            """
            INSERT INTO model_providers (
              id, workspace_id, name, kind, base_url,
              api_key_ciphertext, enabled, sort_order
            ) VALUES (?, ?, ?, 'senseaudio_asr', ?, ?, 1, 2)
            """,
            (
                "existing-senseaudio-provider",
                keyed_workspace,
                "已有 SenseAudio",
                "https://api.senseaudio.cn/v1",
                "encrypted-workspace-key",
            ),
        )
        connection.execute(
            """
            INSERT INTO model_entries (
              id, workspace_id, provider_id, slug, label, description,
              capabilities, categories, enabled, sort_order
            ) VALUES (?, ?, ?, 'existing-asr', 'Existing', '',
                      '["speech_recognition"]', '["speech_recognition"]', 1, 0)
            """,
            ("existing-model", keyed_workspace, "existing-senseaudio-provider"),
        )
        connection.commit()

    assert apply_migrations(database_path) == (LATEST_MIGRATION_ID, True)
    with connect_database(database_path) as connection:
        rows = connection.execute(
            """
            SELECT workspace_id, id, api_key_ciphertext, enabled
            FROM model_providers
            WHERE kind = 'senseaudio_realtime'
            ORDER BY workspace_id
            """
        ).fetchall()
        models = connection.execute(
            """
            SELECT provider.workspace_id, model.slug, model.capabilities, model.categories
            FROM model_entries AS model
            JOIN model_providers AS provider ON provider.id = model.provider_id
            WHERE provider.kind = 'senseaudio_realtime'
            ORDER BY provider.workspace_id
            """
        ).fetchall()
        revisions = dict(
            connection.execute(
                "SELECT id, revision FROM model_catalog_state WHERE id IN (?, ?)",
                (keyed_workspace, empty_workspace),
            ).fetchall()
        )
        existing_model = connection.execute(
            "SELECT provider_id FROM model_entries WHERE id = 'existing-model'"
        ).fetchone()
        foreign_key_errors = connection.execute("PRAGMA foreign_key_check").fetchall()

    keyed = next(row for row in rows if row[0] == keyed_workspace)
    empty = next(row for row in rows if row[0] == empty_workspace)
    assert keyed[1] == "r0030-12345678123456789abcdef0123456"
    assert keyed[2:] == ("encrypted-workspace-key", 1)
    assert empty[2:] == ("", 0)
    expected_model = (
        "senseaudio-realtime-1.0",
        '["voice"]',
        '["end_to_end_speech"]',
    )
    assert all(row[1:] == expected_model for row in models)
    assert revisions == {keyed_workspace: 9, empty_workspace: 6}
    assert existing_model == ("existing-senseaudio-provider",)
    assert foreign_key_errors == []


def test_r0025_clones_existing_asr_credentials_and_enabled_state(tmp_path: Path) -> None:
    database_path = tmp_path / "r0024-pro-asr-upgrade.db"
    _create_database_at_migration(database_path, _migration_count_before("r0025_pro_asr_provider"))
    with connect_database(database_path) as connection:
        connection.execute(
            """
            INSERT INTO model_providers (
              id, workspace_id, name, kind, base_url,
              api_key_ciphertext, enabled, sort_order
            ) VALUES (?, 'default', ?, 'senseaudio_asr', ?, ?, 1, 7)
            """,
            (
                "source-asr-provider",
                "用户 ASR",
                "https://api.senseaudio.cn/v1",
                "encrypted-asr-key",
            ),
        )
        connection.execute(
            """
            INSERT INTO model_entries (
              id, workspace_id, provider_id, slug, label, description,
              capabilities, categories, enabled, sort_order
            ) VALUES (?, 'default', ?, ?, ?, '', ?, ?, 1, 0)
            """,
            (
                "source-asr-model",
                "source-asr-provider",
                "senseaudio-asr-pro-1.5-260319",
                "SenseAudio ASR Pro 1.5",
                '["speech_recognition"]',
                '["speech_recognition"]',
            ),
        )
        before_revision = connection.execute(
            "SELECT revision FROM model_catalog_state WHERE id = 'default'"
        ).fetchone()[0]
        connection.commit()

    assert apply_migrations(database_path) == (LATEST_MIGRATION_ID, True)
    with connect_database(database_path) as connection:
        cloned = connection.execute(
            """
            SELECT provider.name, provider.kind, provider.base_url,
                   provider.api_key_ciphertext, provider.enabled,
                   entry.slug, entry.capabilities, entry.categories
            FROM model_providers AS provider
            JOIN model_entries AS entry ON entry.provider_id = provider.id
            WHERE provider.base_url = ?
            """,
            ("http://180.184.148.131:30002/api/v2/asr/pro",),
        ).fetchone()
        revision = connection.execute(
            "SELECT revision FROM model_catalog_state WHERE id = 'default'"
        ).fetchone()[0]
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []

    assert cloned == (
        "ASR API 专业语音识别",
        "senseaudio_asr",
        "http://180.184.148.131:30002/api/v2/asr/pro",
        "encrypted-asr-key",
        1,
        "pro-asr",
        '["speech_recognition"]',
        '["speech_recognition"]',
    )
    assert revision == before_revision + 3


def test_r0026_expands_transcription_storage_limit_and_preserves_tasks(tmp_path: Path) -> None:
    database_path = tmp_path / "r0025-transcription-limit.db"
    _create_database_at_migration(
        database_path, _migration_count_before("r0026_transcription_100mb")
    )
    insert_sql = """
        INSERT INTO model_test_transcription_tasks (
          id, workspace_id, provider_kind, provider_name, model_slug,
          source_kind, input_storage_key, input_filename, input_mime_type,
          input_byte_size, language, status
        ) VALUES (?, 'default', 'senseaudio_asr', 'ASR', 'pro-asr',
                  'upload', ?, ?, 'audio/mpeg', ?, 'zh', 'completed')
    """
    with connect_database(database_path) as connection:
        connection.execute(
            insert_sql,
            ("existing-transcription", "existing-key", "existing.mp3", 10 * 1024 * 1024),
        )
        connection.commit()

    assert apply_migrations(database_path) == (LATEST_MIGRATION_ID, True)
    with connect_database(database_path) as connection:
        assert connection.execute(
            "SELECT input_filename, input_byte_size FROM model_test_transcription_tasks "
            "WHERE id = 'existing-transcription'"
        ).fetchone() == ("existing.mp3", 10 * 1024 * 1024)
        connection.execute(
            insert_sql,
            ("max-transcription", "max-key", "max.mp3", 100 * 1024 * 1024),
        )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                insert_sql,
                (
                    "oversized-transcription",
                    "oversized-key",
                    "oversized.mp3",
                    100 * 1024 * 1024 + 1,
                ),
            )
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


def test_r0027_backfills_transcription_parameter_snapshots(tmp_path: Path) -> None:
    database_path = tmp_path / "r0026-transcription-parameters.db"
    _create_database_at_migration(
        database_path, _migration_count_before("r0027_transcription_parameters")
    )
    with connect_database(database_path) as connection:
        connection.executemany(
            """
            INSERT INTO model_test_transcription_tasks (
              id, workspace_id, provider_kind, provider_name, model_slug,
              source_kind, input_storage_key, input_filename, input_mime_type,
              input_byte_size, language, status
            ) VALUES (?, 'default', ?, '历史供应商', ?, 'upload', ?, ?,
                      'audio/mpeg', 128, ?, 'completed')
            """,
            [
                (
                    "custom-pro",
                    "senseaudio_asr",
                    "pro-asr",
                    "key-pro",
                    "pro.mp3",
                    "zh",
                ),
                (
                    "official-standard",
                    "senseaudio_asr",
                    "senseaudio-asr-standard-1.0",
                    "key-standard",
                    "standard.mp3",
                    "zh",
                ),
                ("openai-asr", "openai", "whisper-1", "key-openai", "openai.mp3", "ja"),
            ],
        )
        connection.commit()

    assert apply_migrations(database_path) == (LATEST_MIGRATION_ID, True)
    with connect_database(database_path) as connection:
        columns = {
            row[1]: row[2]
            for row in connection.execute(
                "PRAGMA table_info(model_test_transcription_tasks)"
            ).fetchall()
        }
        rows = connection.execute(
            "SELECT id, request_options, result_detail "
            "FROM model_test_transcription_tasks ORDER BY id"
        ).fetchall()
        snapshots = {row[0]: json.loads(row[1]) for row in rows}
        assert columns["language"] == "VARCHAR(128)"
        assert columns["request_options"] == "JSON"
        assert columns["result_detail"] == "JSON"
        assert snapshots["custom-pro"] == {
            "language": "zh",
            "target_language": None,
            "enable_word_timestamps": 0,
            "enable_text_edit": 1,
            "enable_speaker_diarization": 1,
            "max_speakers": None,
            "enable_punctuation": 0,
            "hotwords": None,
            "abbreviations": 0,
        }
        assert snapshots["official-standard"]["enable_punctuation"] == 1
        assert snapshots["official-standard"]["enable_speaker_diarization"] == 1
        assert snapshots["openai-asr"]["enable_speaker_diarization"] == 0
        assert all(json.loads(row[2]) == {} for row in rows)
        connection.execute(
            "UPDATE model_test_transcription_tasks "
            "SET language = 'Chinese,English' WHERE id = 'custom-pro'"
        )
        assert connection.execute(
            "SELECT language FROM model_test_transcription_tasks WHERE id = 'custom-pro'"
        ).fetchone() == ("Chinese,English",)
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


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
    _create_database_at_migration(
        database_path, _migration_count_before("r0026_transcription_100mb")
    )
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
        LATEST_MIGRATION_ID,
        True,
    )
    assert apply_migrations(database_path) == (
        LATEST_MIGRATION_ID,
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
        LATEST_MIGRATION_ID,
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
    assert revision == (13,)
    assert stored_categories == {
        "[]",
        '["speech_recognition"]',
        '["end_to_end_speech"]',
        '["music_generation"]',
    }

    assert apply_migrations(database_path) == (
        LATEST_MIGRATION_ID,
        False,
    )
    with connect_database(database_path) as connection:
        assert connection.execute(
            "SELECT revision FROM model_catalog_state WHERE id = 'default'"
        ).fetchone() == (13,)
        assert connection.execute("SELECT COUNT(*) FROM model_entries").fetchone() == (25,)


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
        ).fetchone() == (2,)
        assert connection.execute("SELECT COUNT(*) FROM model_entries").fetchone() == (5,)
        assert connection.execute(
            "SELECT COUNT(*) FROM model_providers WHERE kind = 'senseaudio_realtime'"
        ).fetchone() == (1,)
        assert connection.execute(
            "SELECT revision FROM model_catalog_state WHERE id = 'default'"
        ).fetchone() == (8,)


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
