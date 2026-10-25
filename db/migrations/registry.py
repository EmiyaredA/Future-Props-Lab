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
    r0039_visual_generation_node_history,
    r0040_video_editor_mixed_tracks,
    r0041_visual_generation_batches,
    r0042_image_compositions,
    r0043_video_editor_playback_rate,
    r0044_thought_workshop,
    r0045_thought_attachments,
    r0046_thought_knowledge_bases,
    r0047_skill_tags,
    r0048_thought_document_tree,
    r0049_thought_history,
    r0050_workspace_governance,
    r0051_platform_governance,
    r0052_role_model_templates,
    r0054_platform_runtime,
    r0055_model_suppliers,
    r0056_presentation_workshop,
    r0057_presentation_styles,
    r0058_presentation_media,
    r0059_project_operations,
    r0060_model_inference,
    r0061_senseaudio_asr_pro_kind,
    r0062_call_log_credential,
    r0063_audio_annotation_custom_emotions,
    r0064_director_desk,
    r0065_director_desk_motions,
    r0066_motion_compositor,
    r0067_video_editor_asset_default_effects_bake,
    r0068_senseaudio_catalog_sync,
    r0069_retire_unsupported_senseaudio_models,
    r0070_amadeus,
    r0071_live2d_workshop,
    r0072_amadeus_runs,
    r0073_live2d_cubism_attachment,
    r0074_live2d_editable_runtime,
    r0075_creative_workshop,
    r0076_amadeus_workflows,
    r0077_desktop_pet,
    r0078_desktop_pet_whale,
    r0079_desktop_pet_chat,
    r0080_thought_knowledge_tools,
    r0081_desktop_pet_presentation,
    r0082_thought_publications,
    r0083_thought_multitable,
    r0084_unified_official_publications,
    r0085_thought_field_config,
    r0086_visual_node_outputs,
    r0087_volcengine_images,
    r0088_external_article_sync,
    r0089_visual_prompt_versions,
    r0090_thought_field_groups,
    r0091_zealman_video,
    r0092_visual_zealman_video,
    r0093_generation_execution_info,
    r0094_visual_node_approval,
    r0095_volcengine_video,
    r0096_presentation_scene,
    r0097_presentation_image_version,
    r0098_presentation_connection_layers,
    r0099_presentation_lists,
    r0100_presentation_connection_offsets,
    r0101_presentation_editor_v3,
    r0102_skill_description,
    r0103_local_models,
    r0104_presentation_free_connections,
    r0105_visual_acceptance,
    r0106_interview_preparation,
    r0107_deepseek_provider,
    r0108_node_acceptance,
    r0109_code_agents,
    r0110_video_editor_clip_merges,
    r0111_presentation_templates,
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
    Migration(
        r0039_visual_generation_node_history.MIGRATION_ID,
        r0039_visual_generation_node_history.SQL,
    ),
    Migration(
        r0040_video_editor_mixed_tracks.MIGRATION_ID,
        r0040_video_editor_mixed_tracks.SQL,
    ),
    Migration(
        r0041_visual_generation_batches.MIGRATION_ID,
        r0041_visual_generation_batches.SQL,
    ),
    Migration(r0042_image_compositions.MIGRATION_ID, r0042_image_compositions.SQL),
    Migration(r0043_video_editor_playback_rate.MIGRATION_ID, r0043_video_editor_playback_rate.SQL),
    Migration(r0044_thought_workshop.MIGRATION_ID, r0044_thought_workshop.SQL),
    Migration(r0045_thought_attachments.MIGRATION_ID, r0045_thought_attachments.SQL),
    Migration(
        r0046_thought_knowledge_bases.MIGRATION_ID,
        r0046_thought_knowledge_bases.SQL,
        foreign_keys_off=True,
    ),
    Migration(r0047_skill_tags.MIGRATION_ID, r0047_skill_tags.SQL),
    Migration(
        r0048_thought_document_tree.MIGRATION_ID,
        r0048_thought_document_tree.SQL,
        foreign_keys_off=True,
    ),
)

MIGRATIONS += (Migration(r0049_thought_history.MIGRATION_ID, r0049_thought_history.SQL),)


MIGRATIONS += (Migration(r0050_workspace_governance.MIGRATION_ID, r0050_workspace_governance.SQL),)

MIGRATIONS += (Migration(r0051_platform_governance.MIGRATION_ID, r0051_platform_governance.SQL),)

MIGRATIONS += (Migration(r0052_role_model_templates.MIGRATION_ID, r0052_role_model_templates.SQL),)

MIGRATIONS += (Migration(r0054_platform_runtime.MIGRATION_ID, r0054_platform_runtime.SQL),)

MIGRATIONS += (Migration(r0055_model_suppliers.MIGRATION_ID, r0055_model_suppliers.SQL),)


MIGRATIONS += (
    Migration(r0056_presentation_workshop.MIGRATION_ID, r0056_presentation_workshop.SQL),
)

MIGRATIONS += (Migration(r0057_presentation_styles.MIGRATION_ID, r0057_presentation_styles.SQL),)


MIGRATIONS += (Migration(r0058_presentation_media.MIGRATION_ID, r0058_presentation_media.SQL),)


MIGRATIONS += (Migration(r0059_project_operations.MIGRATION_ID, r0059_project_operations.SQL),)


MIGRATIONS += (Migration(r0060_model_inference.MIGRATION_ID, r0060_model_inference.SQL),)

MIGRATIONS += (
    Migration(
        r0061_senseaudio_asr_pro_kind.MIGRATION_ID,
        r0061_senseaudio_asr_pro_kind.SQL,
        foreign_keys_off=True,
    ),
)

MIGRATIONS += (Migration(r0062_call_log_credential.MIGRATION_ID, r0062_call_log_credential.SQL),)

MIGRATIONS += (
    Migration(
        r0063_audio_annotation_custom_emotions.MIGRATION_ID,
        r0063_audio_annotation_custom_emotions.SQL,
    ),
)

MIGRATIONS += (Migration(r0064_director_desk.MIGRATION_ID, r0064_director_desk.SQL),)

MIGRATIONS += (
    Migration(r0065_director_desk_motions.MIGRATION_ID, r0065_director_desk_motions.SQL),
)

MIGRATIONS += (Migration(r0066_motion_compositor.MIGRATION_ID, r0066_motion_compositor.SQL),)

MIGRATIONS += (
    Migration(
        r0067_video_editor_asset_default_effects_bake.MIGRATION_ID,
        r0067_video_editor_asset_default_effects_bake.SQL,
        foreign_keys_off=True,
    ),
)

MIGRATIONS += (
    Migration(
        r0068_senseaudio_catalog_sync.MIGRATION_ID,
        r0068_senseaudio_catalog_sync.SQL,
    ),
)

MIGRATIONS += (
    Migration(
        r0069_retire_unsupported_senseaudio_models.MIGRATION_ID,
        r0069_retire_unsupported_senseaudio_models.SQL,
    ),
)

MIGRATIONS += (Migration(r0070_amadeus.MIGRATION_ID, r0070_amadeus.SQL),)

MIGRATIONS += (Migration(r0071_live2d_workshop.MIGRATION_ID, r0071_live2d_workshop.SQL),)

MIGRATIONS += (Migration(r0072_amadeus_runs.MIGRATION_ID, r0072_amadeus_runs.SQL),)

MIGRATIONS += (
    Migration(r0073_live2d_cubism_attachment.MIGRATION_ID, r0073_live2d_cubism_attachment.SQL),
)

MIGRATIONS += (
    Migration(r0074_live2d_editable_runtime.MIGRATION_ID, r0074_live2d_editable_runtime.SQL),
)

MIGRATIONS += (Migration(r0075_creative_workshop.MIGRATION_ID, r0075_creative_workshop.SQL),)

MIGRATIONS += (Migration(r0076_amadeus_workflows.MIGRATION_ID, r0076_amadeus_workflows.SQL),)

MIGRATIONS += (Migration(r0077_desktop_pet.MIGRATION_ID, r0077_desktop_pet.SQL),)

MIGRATIONS += (Migration(r0078_desktop_pet_whale.MIGRATION_ID, r0078_desktop_pet_whale.SQL),)

MIGRATIONS += (Migration(r0079_desktop_pet_chat.MIGRATION_ID, r0079_desktop_pet_chat.SQL),)

MIGRATIONS += (
    Migration(r0080_thought_knowledge_tools.MIGRATION_ID, r0080_thought_knowledge_tools.SQL),
    Migration(r0081_desktop_pet_presentation.MIGRATION_ID, r0081_desktop_pet_presentation.SQL),
)

MIGRATIONS += (Migration(r0082_thought_publications.MIGRATION_ID, r0082_thought_publications.SQL),)

MIGRATIONS += (Migration(r0083_thought_multitable.MIGRATION_ID, r0083_thought_multitable.SQL),)

MIGRATIONS += (
    Migration(
        r0084_unified_official_publications.MIGRATION_ID, r0084_unified_official_publications.SQL
    ),
)

MIGRATIONS += (Migration(r0085_thought_field_config.MIGRATION_ID, r0085_thought_field_config.SQL),)

MIGRATIONS += (Migration(r0086_visual_node_outputs.MIGRATION_ID, r0086_visual_node_outputs.SQL),)

MIGRATIONS += (
    Migration(
        r0087_volcengine_images.MIGRATION_ID, r0087_volcengine_images.SQL, foreign_keys_off=True
    ),
)

MIGRATIONS += (
    Migration(r0088_external_article_sync.MIGRATION_ID, r0088_external_article_sync.SQL),
)

MIGRATIONS += (
    Migration(r0089_visual_prompt_versions.MIGRATION_ID, r0089_visual_prompt_versions.SQL),
)

MIGRATIONS += (Migration(r0090_thought_field_groups.MIGRATION_ID, r0090_thought_field_groups.SQL),)

MIGRATIONS += (
    Migration(r0091_zealman_video.MIGRATION_ID, r0091_zealman_video.SQL, foreign_keys_off=True),
)

MIGRATIONS += (
    Migration(
        r0092_visual_zealman_video.MIGRATION_ID,
        r0092_visual_zealman_video.SQL,
        foreign_keys_off=True,
    ),
)

MIGRATIONS += (
    Migration(r0093_generation_execution_info.MIGRATION_ID, r0093_generation_execution_info.SQL),
)

MIGRATIONS += (Migration(r0094_visual_node_approval.MIGRATION_ID, r0094_visual_node_approval.SQL),)

MIGRATIONS += (
    Migration(
        r0095_volcengine_video.MIGRATION_ID, r0095_volcengine_video.SQL, foreign_keys_off=True
    ),
)

MIGRATIONS += (Migration(r0096_presentation_scene.MIGRATION_ID, r0096_presentation_scene.SQL),)

MIGRATIONS += (
    Migration(r0097_presentation_image_version.MIGRATION_ID, r0097_presentation_image_version.SQL),
)

MIGRATIONS += (
    Migration(
        r0098_presentation_connection_layers.MIGRATION_ID, r0098_presentation_connection_layers.SQL
    ),
)

MIGRATIONS += (Migration(r0099_presentation_lists.MIGRATION_ID, r0099_presentation_lists.SQL),)

MIGRATIONS += (
    Migration(
        r0100_presentation_connection_offsets.MIGRATION_ID,
        r0100_presentation_connection_offsets.SQL,
    ),
)

MIGRATIONS += (
    Migration(r0101_presentation_editor_v3.MIGRATION_ID, r0101_presentation_editor_v3.SQL),
)

MIGRATIONS += (
    Migration(
        r0102_skill_description.MIGRATION_ID, r0102_skill_description.SQL, foreign_keys_off=True
    ),
)


MIGRATIONS += (
    Migration(r0103_local_models.MIGRATION_ID, r0103_local_models.SQL, foreign_keys_off=True),
)

MIGRATIONS += (
    Migration(
        r0104_presentation_free_connections.MIGRATION_ID, r0104_presentation_free_connections.SQL
    ),
)

MIGRATIONS += (Migration(r0105_visual_acceptance.MIGRATION_ID, r0105_visual_acceptance.SQL),)

MIGRATIONS += (
    Migration(r0106_interview_preparation.MIGRATION_ID, r0106_interview_preparation.SQL),
)

MIGRATIONS += (
    Migration(
        r0107_deepseek_provider.MIGRATION_ID, r0107_deepseek_provider.SQL, foreign_keys_off=True
    ),
)

MIGRATIONS += (Migration(r0108_node_acceptance.MIGRATION_ID, r0108_node_acceptance.SQL),)

MIGRATIONS += (Migration(r0109_code_agents.MIGRATION_ID, r0109_code_agents.SQL),)

MIGRATIONS += (
    Migration(r0110_video_editor_clip_merges.MIGRATION_ID, r0110_video_editor_clip_merges.SQL),
)


MIGRATIONS += (
    Migration(r0111_presentation_templates.MIGRATION_ID, r0111_presentation_templates.SQL),
)

LATEST_MIGRATION_ID = MIGRATIONS[-1].migration_id
