from __future__ import annotations

from dataclasses import dataclass

from db.migrations.versions import (
    r0001_initial,
    r0002_model_test_conversations,
    r0003_tool_navigation_state,
    r0004_expand_senseaudio_text_catalog,
    r0005_visual_workshop_projects,
    r0006_file_management,
    r0007_model_test_attachments,
    r0008_visual_generation,
    r0009_visual_canvas_documents,
    r0010_model_categories_and_test_generation,
    r0011_visual_assistant_conversations,
    r0012_visual_assistant_actions,
    r0013_visual_assistant_generation_models,
    r0014_visual_assistant_content_parts,
    r0015_model_test_generation_assets,
    r0016_galgame_workshop_projects,
    r0017_galgame_character_assets,
    r0018_galgame_asset_management,
    r0019_project_storage_layout,
    r0020_accounts_and_workspaces,
    r0021_senseaudio_asr,
    r0022_audio_annotation,
    r0023_senseaudio_asr_fresh_catalog,
    r0024_model_test_transcription,
    r0025_pro_asr_provider,
    r0026_transcription_100mb,
    r0027_transcription_parameters,
    r0028_galgame_annotation_imports,
    r0029_galgame_video_exports,
    r0030_senseaudio_realtime,
    r0031_integration_center,
    r0032_realtime_fresh_catalog,
    r0033_model_test_tools,
    r0034_realtime_tool_calls,
    r0035_video_editor,
    r0036_galgame_video_editor_handoffs,
    r0037_media_workshop_upgrade,
    r0038_media_workshop_tasks_and_audio,
)


@dataclass(frozen=True)
class Migration:
    migration_id: str
    sql: str
    foreign_keys_off: bool = False


MIGRATIONS = (
    Migration(r0001_initial.MIGRATION_ID, r0001_initial.SQL),
    Migration(
        r0002_model_test_conversations.MIGRATION_ID,
        r0002_model_test_conversations.SQL,
    ),
    Migration(
        r0003_tool_navigation_state.MIGRATION_ID,
        r0003_tool_navigation_state.SQL,
    ),
    Migration(
        r0004_expand_senseaudio_text_catalog.MIGRATION_ID,
        r0004_expand_senseaudio_text_catalog.SQL,
    ),
    Migration(
        r0005_visual_workshop_projects.MIGRATION_ID,
        r0005_visual_workshop_projects.SQL,
    ),
    Migration(r0006_file_management.MIGRATION_ID, r0006_file_management.SQL),
    Migration(
        r0007_model_test_attachments.MIGRATION_ID,
        r0007_model_test_attachments.SQL,
    ),
    Migration(
        r0008_visual_generation.MIGRATION_ID,
        r0008_visual_generation.SQL,
        foreign_keys_off=True,
    ),
    Migration(
        r0009_visual_canvas_documents.MIGRATION_ID,
        r0009_visual_canvas_documents.SQL,
    ),
    Migration(
        r0010_model_categories_and_test_generation.MIGRATION_ID,
        r0010_model_categories_and_test_generation.SQL,
    ),
    Migration(
        r0011_visual_assistant_conversations.MIGRATION_ID,
        r0011_visual_assistant_conversations.SQL,
    ),
    Migration(
        r0012_visual_assistant_actions.MIGRATION_ID,
        r0012_visual_assistant_actions.SQL,
    ),
    Migration(
        r0013_visual_assistant_generation_models.MIGRATION_ID,
        r0013_visual_assistant_generation_models.SQL,
    ),
    Migration(
        r0014_visual_assistant_content_parts.MIGRATION_ID,
        r0014_visual_assistant_content_parts.SQL,
    ),
    Migration(
        r0015_model_test_generation_assets.MIGRATION_ID,
        r0015_model_test_generation_assets.SQL,
    ),
    Migration(
        r0016_galgame_workshop_projects.MIGRATION_ID,
        r0016_galgame_workshop_projects.SQL,
    ),
    Migration(
        r0017_galgame_character_assets.MIGRATION_ID,
        r0017_galgame_character_assets.SQL,
    ),
    Migration(
        r0018_galgame_asset_management.MIGRATION_ID,
        r0018_galgame_asset_management.SQL,
    ),
    Migration(
        r0019_project_storage_layout.MIGRATION_ID,
        r0019_project_storage_layout.SQL,
    ),
    Migration(
        r0020_accounts_and_workspaces.MIGRATION_ID,
        r0020_accounts_and_workspaces.SQL,
        foreign_keys_off=True,
    ),
    Migration(
        r0021_senseaudio_asr.MIGRATION_ID,
        r0021_senseaudio_asr.SQL,
        foreign_keys_off=True,
    ),
    Migration(r0022_audio_annotation.MIGRATION_ID, r0022_audio_annotation.SQL),
    Migration(
        r0023_senseaudio_asr_fresh_catalog.MIGRATION_ID,
        r0023_senseaudio_asr_fresh_catalog.SQL,
    ),
    Migration(
        r0024_model_test_transcription.MIGRATION_ID,
        r0024_model_test_transcription.SQL,
    ),
    Migration(r0025_pro_asr_provider.MIGRATION_ID, r0025_pro_asr_provider.SQL),
    Migration(
        r0026_transcription_100mb.MIGRATION_ID,
        r0026_transcription_100mb.SQL,
        foreign_keys_off=True,
    ),
    Migration(
        r0027_transcription_parameters.MIGRATION_ID,
        r0027_transcription_parameters.SQL,
        foreign_keys_off=True,
    ),
    Migration(
        r0028_galgame_annotation_imports.MIGRATION_ID,
        r0028_galgame_annotation_imports.SQL,
    ),
    Migration(
        r0029_galgame_video_exports.MIGRATION_ID,
        r0029_galgame_video_exports.SQL,
    ),
    Migration(
        r0030_senseaudio_realtime.MIGRATION_ID,
        r0030_senseaudio_realtime.SQL,
        foreign_keys_off=True,
    ),
    Migration(r0031_integration_center.MIGRATION_ID, r0031_integration_center.SQL),
    Migration(
        r0032_realtime_fresh_catalog.MIGRATION_ID,
        r0032_realtime_fresh_catalog.SQL,
    ),
    Migration(r0033_model_test_tools.MIGRATION_ID, r0033_model_test_tools.SQL),
    Migration(
        r0034_realtime_tool_calls.MIGRATION_ID,
        r0034_realtime_tool_calls.SQL,
        foreign_keys_off=True,
    ),
    Migration(r0035_video_editor.MIGRATION_ID, r0035_video_editor.SQL),
    Migration(
        r0036_galgame_video_editor_handoffs.MIGRATION_ID,
        r0036_galgame_video_editor_handoffs.SQL,
    ),
    Migration(
        r0037_media_workshop_upgrade.MIGRATION_ID,
        r0037_media_workshop_upgrade.SQL,
    ),
    Migration(
        r0038_media_workshop_tasks_and_audio.MIGRATION_ID,
        r0038_media_workshop_tasks_and_audio.SQL,
        foreign_keys_off=True,
    ),
)

LATEST_MIGRATION_ID = MIGRATIONS[-1].migration_id
