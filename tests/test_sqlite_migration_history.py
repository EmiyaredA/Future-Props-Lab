import json
from pathlib import Path

from db.migrations import apply_migrations, runner
from db.migrations.registry import LATEST_MIGRATION_ID, MIGRATIONS
from db.migrations.runner import connect_database, ensure_registry, migration_checksum


def test_multitable_migration_preserves_existing_note_payload(tmp_path: Path, monkeypatch) -> None:
    database = tmp_path / "multitable-upgrade.db"
    original = json.dumps(
        {
            "type": "doc",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": "旧笔记正文"}]}],
        },
        ensure_ascii=False,
    )
    with monkeypatch.context() as patch:
        patch.setattr(runner, "MIGRATIONS", MIGRATIONS[:-1])
        patch.setattr(runner, "LATEST_MIGRATION_ID", MIGRATIONS[-2].migration_id)
        apply_migrations(database)
    with connect_database(database) as connection:
        workspace = connection.execute("SELECT id FROM workspaces LIMIT 1").fetchone()[0]
        connection.execute(
            "INSERT INTO thought_knowledge_bases (id,workspace_id,title,created_at,updated_at) "
            "VALUES ('legacy-kb',?,'旧知识库','2026-01-01','2026-01-01')",
            (workspace,),
        )
        connection.execute(
            "INSERT INTO thought_notes (id,workspace_id,knowledge_base_id,title,document,revision,"
            "created_at,updated_at) VALUES ('legacy-note',?,'legacy-kb','旧笔记',?,7,"
            "'2026-01-01','2026-01-01')",
            (workspace, original),
        )
        connection.commit()
    assert apply_migrations(database) == (LATEST_MIGRATION_ID, True)
    with connect_database(database) as connection:
        assert connection.execute(
            "SELECT kind,document,revision FROM thought_notes WHERE id='legacy-note'"
        ).fetchone() == ("note", original, 7)
        assert connection.execute("SELECT count(*) FROM thought_data_tables").fetchone() == (0,)


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
            "SELECT migration_id FROM schema_migrations ORDER BY rowid"
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
            ("r0043_video_editor_playback_rate",),
            ("0044_thought_workshop",),
            ("0045_thought_attachments",),
            ("0046_thought_knowledge_bases",),
            ("0047_skill_tags",),
            ("0048_thought_document_tree",),
            ("0049_thought_history",),
            ("r0050_workspace_governance",),
            ("r0051_platform_governance",),
            ("r0052_role_model_templates",),
            ("r0054_platform_runtime",),
            ("r0055_model_suppliers",),
            ("0056_presentation_workshop",),
            ("0057_presentation_styles",),
            ("0058_presentation_media",),
            ("0059_project_operations",),
            ("0060_model_inference",),
            ("r0061_senseaudio_asr_pro_kind",),
            ("r0062_call_log_credential",),
            ("r0063_audio_annotation_custom_emotions",),
            ("r0064_director_desk",),
            ("r0065_director_desk_motions",),
            ("r0066_motion_compositor",),
            ("r0067_video_editor_asset_default_effects_bake",),
            ("r0068_senseaudio_catalog_sync",),
            ("r0069_retire_unsupported_senseaudio_models",),
            ("r0070_amadeus",),
            ("r0071_live2d_workshop",),
            ("r0072_amadeus_runs",),
            ("r0073_live2d_cubism_attachment",),
            ("r0074_live2d_editable_runtime",),
            ("r0075_creative_workshop",),
            ("r0076_amadeus_workflows",),
            ("r0077_desktop_pet",),
            ("r0078_desktop_pet_whale",),
            ("r0079_desktop_pet_chat",),
            ("0080_thought_knowledge_tools",),
            ("r0081_desktop_pet_presentation",),
            ("0082_thought_publications",),
            ("0083_thought_multitable",),
            ("0084_unified_official_publications",),
            ("0085_thought_field_config",),
            ("r0086_visual_node_outputs",),
            ("r0087_volcengine_images",),
            ("0088_external_article_sync",),
            ("r0089_visual_prompt_versions",),
            ("0090_thought_field_groups",),
            ("0091_zealman_video",),
            ("0092_visual_zealman_video",),
            ("0093_generation_execution_info",),
            ("r0094_visual_node_approval",),
            ("0095_volcengine_video",),
            ("0096_presentation_scene",),
            ("0097_presentation_image_version",),
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


def test_official_publication_migration_retains_existing_publication_behavior(
    tmp_path, monkeypatch
):
    database = tmp_path / "official-upgrade.db"
    with monkeypatch.context() as patch:
        patch.setattr(runner, "MIGRATIONS", MIGRATIONS[:-1])
        apply_migrations(database)
    with connect_database(database) as connection:
        # All rows belong to this test's temporary database, never runtime data.
        connection.execute("""
            INSERT INTO users (id, username, username_normalized, display_name,
                password_hash, status, is_platform_admin, platform_role,
                must_change_password, revision, created_at, updated_at)
            VALUES ('official-user', 'official-user', 'official-user', 'User',
                'test', 'active', 0, 'member', 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        """)
        connection.execute("""
            INSERT INTO workspaces (id, name, visibility, revision, created_at, updated_at)
            VALUES ('official-ws', 'Test', 'private', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        """)
        connection.execute("""
            INSERT INTO thought_knowledge_bases
                (id, title, description, workspace_id, revision, created_at, updated_at)
            VALUES ('official-library', 'Test', '', 'official-ws', 0,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        """)
        connection.execute("""
            INSERT INTO thought_publications (id, workspace_id, knowledge_base_id,
                publisher_id, title, description, active, revision, updated_at)
            VALUES ('legacy-pub', 'official-ws', 'official-library', 'official-user',
                'Test', '', 1, 7, CURRENT_TIMESTAMP)
        """)
        connection.commit()
    apply_migrations(database)
    with connect_database(database) as connection:
        row = connection.execute(
            "SELECT is_official, read_only, editable_platform_roles, revision "
            "FROM thought_publications WHERE id='legacy-pub'"
        ).fetchone()
        assert row == (0, 0, "[]", 7)
        assert connection.execute("SELECT COUNT(*) FROM thought_official_sources").fetchone() == (
            0,
        )
        assert connection.execute(
            "SELECT COUNT(*) FROM thought_official_import_receipts"
        ).fetchone() == (0,)
