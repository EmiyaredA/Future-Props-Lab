from pathlib import Path

from db.migrations import apply_migrations
from db.migrations.registry import LATEST_MIGRATION_ID, MIGRATIONS
from db.migrations.runner import connect_database, ensure_registry, migration_checksum


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
