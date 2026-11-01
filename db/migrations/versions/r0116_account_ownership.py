"""Replace logical workspaces with direct account ownership."""

from .account_ownership import (
    animation,
    galgame,
    identity,
    integrations,
    knowledge,
    media,
    models,
    visual,
)

MIGRATION_ID = "0116_account_ownership"

PRELUDE = """

CREATE TEMP TABLE _account_owners(source_id TEXT PRIMARY KEY, owner_user_id TEXT, ordinal INTEGER);
INSERT INTO _account_owners
SELECT w.id, (SELECT m.user_id FROM workspace_memberships m WHERE m.workspace_id=w.id AND m.role=
    'owner' AND m.status='active'),
       row_number() OVER (ORDER BY w.created_at,w.id)
FROM workspaces w;
CREATE TEMP TABLE _account_ownership_guard(valid INTEGER CHECK(valid=1));
INSERT INTO _account_ownership_guard
SELECT CASE WHEN (NOT EXISTS(SELECT 1 FROM users) AND NOT (
 EXISTS(SELECT 1 FROM "model_entries") OR
 EXISTS(SELECT 1 FROM "llm_call_logs") OR
 EXISTS(SELECT 1 FROM "model_test_conversations") OR
 EXISTS(SELECT 1 FROM "visual_workshop_projects") OR
 EXISTS(SELECT 1 FROM "visual_asset_folders") OR
 EXISTS(SELECT 1 FROM "visual_assets") OR
 EXISTS(SELECT 1 FROM "visual_project_asset_references") OR
 EXISTS(SELECT 1 FROM "visual_assistant_conversations") OR
 EXISTS(SELECT 1 FROM "model_test_generation_assets") OR
 EXISTS(SELECT 1 FROM "galgame_workshop_projects") OR
 EXISTS(SELECT 1 FROM "galgame_asset_transcription_tasks") OR
 EXISTS(SELECT 1 FROM "auth_sessions") OR
 EXISTS(SELECT 1 FROM "management_api_keys") OR
 EXISTS(SELECT 1 FROM "security_audit_events") OR
 EXISTS(SELECT 1 FROM "tool_navigation_items") OR
 EXISTS(SELECT 1 FROM "audio_annotation_projects") OR
 EXISTS(SELECT 1 FROM "galgame_annotation_import_tasks") OR
 EXISTS(SELECT 1 FROM "galgame_video_export_tasks") OR
 EXISTS(SELECT 1 FROM "integration_tool_apis") OR
 EXISTS(SELECT 1 FROM "integration_mcp_servers") OR
 EXISTS(SELECT 1 FROM "integration_checks") OR
 EXISTS(SELECT 1 FROM "model_test_tools") OR
 EXISTS(SELECT 1 FROM "model_test_tool_calls") OR
 EXISTS(SELECT 1 FROM "video_editor_projects") OR
 EXISTS(SELECT 1 FROM "video_editor_operation_batches") OR
 EXISTS(SELECT 1 FROM "galgame_video_editor_handoffs") OR
 EXISTS(SELECT 1 FROM "thought_knowledge_bases") OR
 EXISTS(SELECT 1 FROM "thought_notes") OR
 EXISTS(SELECT 1 FROM "model_template_sync_items") OR
 EXISTS(SELECT 1 FROM "runtime_admissions") OR
 EXISTS(SELECT 1 FROM "model_suppliers") OR
 EXISTS(SELECT 1 FROM "presentation_projects") OR
 EXISTS(SELECT 1 FROM "project_operation_receipts") OR
 EXISTS(SELECT 1 FROM "model_inference_tasks") OR
 EXISTS(SELECT 1 FROM "model_inference_assets") OR
 EXISTS(SELECT 1 FROM "model_test_transcription_tasks") OR
 EXISTS(SELECT 1 FROM "director_desk_projects") OR
 EXISTS(SELECT 1 FROM "director_desk_user_motions") OR
 EXISTS(SELECT 1 FROM "motion_compositor_projects") OR
 EXISTS(SELECT 1 FROM "motion_compositor_operation_batches") OR
 EXISTS(SELECT 1 FROM "motion_compositor_tasks") OR
 EXISTS(SELECT 1 FROM "amadeus_conversations") OR
 EXISTS(SELECT 1 FROM "amadeus_messages") OR
 EXISTS(SELECT 1 FROM "amadeus_actions") OR
 EXISTS(SELECT 1 FROM "live2d_projects") OR
 EXISTS(SELECT 1 FROM "live2d_assets") OR
 EXISTS(SELECT 1 FROM "live2d_exports") OR
 EXISTS(SELECT 1 FROM "amadeus_runs") OR
 EXISTS(SELECT 1 FROM "amadeus_run_events") OR
 EXISTS(SELECT 1 FROM "live2d_cubism_attachments") OR
 EXISTS(SELECT 1 FROM "creative_items") OR
 EXISTS(SELECT 1 FROM "creative_installations") OR
 EXISTS(SELECT 1 FROM "amadeus_questions") OR
 EXISTS(SELECT 1 FROM "desktop_pet_projects") OR
 EXISTS(SELECT 1 FROM "desktop_pet_chats") OR
 EXISTS(SELECT 1 FROM "thought_templates") OR
 EXISTS(SELECT 1 FROM "thought_saved_filters") OR
 EXISTS(SELECT 1 FROM "thought_reading_states") OR
 EXISTS(SELECT 1 FROM "thought_publications") OR
 EXISTS(SELECT 1 FROM "thought_official_sources") OR
 EXISTS(SELECT 1 FROM "thought_official_import_receipts") OR
 EXISTS(SELECT 1 FROM "integration_external_connections") OR
 EXISTS(SELECT 1 FROM "thought_sync_bindings") OR
 EXISTS(SELECT 1 FROM "thought_sync_tasks") OR
 EXISTS(SELECT 1 FROM "integration_skills") OR
 EXISTS(SELECT 1 FROM "visual_acceptance_templates") OR
 EXISTS(SELECT 1 FROM "visual_acceptance_standards") OR
 EXISTS(SELECT 1 FROM "visual_acceptance_standard_versions") OR
 EXISTS(SELECT 1 FROM "visual_acceptance_runs") OR
 EXISTS(SELECT 1 FROM "visual_acceptance_repair_drafts") OR
 EXISTS(SELECT 1 FROM "interview_rooms") OR
 EXISTS(SELECT 1 FROM "interview_preparations") OR
 EXISTS(SELECT 1 FROM "visual_node_acceptance_bindings") OR
 EXISTS(SELECT 1 FROM "video_editor_tasks") OR
 EXISTS(SELECT 1 FROM "presentation_templates") OR
 EXISTS(SELECT 1 FROM "presentation_examples") OR
 EXISTS(SELECT 1 FROM "model_providers") OR
 EXISTS(SELECT 1 FROM "model_test_generation_tasks") OR
 EXISTS(SELECT 1 FROM "visual_generation_tasks") OR
 EXISTS(SELECT 1 FROM "visual_generation_batches")
)) OR NOT EXISTS (
 SELECT 1 FROM workspaces w WHERE (SELECT count(*) FROM workspace_memberships m
 WHERE m.workspace_id=w.id AND m.role='owner' AND m.status='active')<>1
) THEN 1 ELSE 0 END;
CREATE TABLE account_storage_upgrade_roots (
 id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL REFERENCES users(id),
 source_relative_root TEXT NOT NULL, target_relative_root TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', error TEXT NOT NULL DEFAULT '',
 UNIQUE(source_relative_root,target_relative_root)
);
INSERT INTO account_storage_upgrade_roots
SELECT source_id,owner_user_id,'workspaces/'||source_id,'accounts/'||owner_user_id,'pending',''
FROM _account_owners WHERE owner_user_id IS NOT NULL;
INSERT INTO account_storage_upgrade_roots SELECT 'default:applications',owner_user_id,
    'applications','accounts/'||owner_user_id||'/applications','pending','' FROM _account_owners
    WHERE source_id='default' AND owner_user_id IS NOT NULL;
INSERT INTO account_storage_upgrade_roots SELECT 'default:library/assets',owner_user_id,
    'library/assets','accounts/'||owner_user_id||'/library/assets','pending','' FROM
    _account_owners WHERE source_id='default' AND owner_user_id IS NOT NULL;
INSERT INTO account_storage_upgrade_roots SELECT 'default:model-test',owner_user_id,'model-test',
    'accounts/'||owner_user_id||'/model-test','pending','' FROM _account_owners WHERE source_id=
    'default' AND owner_user_id IS NOT NULL;
INSERT INTO account_storage_upgrade_roots SELECT 'default:model-inference',owner_user_id,
    'model-inference','accounts/'||owner_user_id||'/model-inference','pending','' FROM
    _account_owners WHERE source_id='default' AND owner_user_id IS NOT NULL;
INSERT INTO account_storage_upgrade_roots SELECT 'default:visual-workshop/assets',owner_user_id,
    'visual-workshop/assets','accounts/'||owner_user_id||'/legacy-assets','pending','' FROM
    _account_owners WHERE source_id='default' AND owner_user_id IS NOT NULL;
INSERT INTO account_storage_upgrade_roots
SELECT 'trash:'||source_id,owner_user_id,'.trash/'||source_id,'.trash/'||owner_user_id,
       'pending','' FROM _account_owners WHERE owner_user_id IS NOT NULL;
INSERT INTO account_storage_upgrade_roots SELECT 'trash:default:visual-workshop',
 owner_user_id,'.trash/visual-workshop',
 '.trash/'||owner_user_id||'/visual-workshop','pending',''
 FROM _account_owners WHERE source_id='default' AND owner_user_id IS NOT NULL;
INSERT INTO account_storage_upgrade_roots SELECT 'trash:default:galgame-workshop',
 owner_user_id,'.trash/galgame-workshop',
 '.trash/'||owner_user_id||'/galgame-workshop','pending',''
 FROM _account_owners WHERE source_id='default' AND owner_user_id IS NOT NULL;
INSERT INTO account_storage_upgrade_roots SELECT 'trash:default:video-editor',
 owner_user_id,'.trash/video-editor',
 '.trash/'||owner_user_id||'/video-editor','pending',''
 FROM _account_owners WHERE source_id='default' AND owner_user_id IS NOT NULL;
INSERT INTO account_storage_upgrade_roots SELECT 'trash:default:motion-compositor',
 owner_user_id,'.trash/motion-compositor',
 '.trash/'||owner_user_id||'/motion-compositor','pending',''
 FROM _account_owners WHERE source_id='default' AND owner_user_id IS NOT NULL;
INSERT INTO account_storage_upgrade_roots SELECT 'trash:default:presentation-workshop',
 owner_user_id,'.trash/presentation-workshop',
 '.trash/'||owner_user_id||'/presentation-workshop','pending',''
 FROM _account_owners WHERE source_id='default' AND owner_user_id IS NOT NULL;
INSERT INTO account_storage_upgrade_roots SELECT 'trash:default:audio-annotation',
 owner_user_id,'.trash/audio-annotation',
 '.trash/'||owner_user_id||'/audio-annotation','pending',''
 FROM _account_owners WHERE source_id='default' AND owner_user_id IS NOT NULL;
INSERT INTO account_storage_upgrade_roots SELECT 'trash:default:director-desk',
 owner_user_id,'.trash/director-desk',
 '.trash/'||owner_user_id||'/director-desk','pending',''
 FROM _account_owners WHERE source_id='default' AND owner_user_id IS NOT NULL;
INSERT INTO account_storage_upgrade_roots SELECT 'trash:default:live2d-workshop',
 owner_user_id,'.trash/live2d-workshop',
 '.trash/'||owner_user_id||'/live2d-workshop','pending',''
 FROM _account_owners WHERE source_id='default' AND owner_user_id IS NOT NULL;
INSERT INTO account_storage_upgrade_roots SELECT 'trash:default:desktop-pet',
 owner_user_id,'.trash/desktop-pet',
 '.trash/'||owner_user_id||'/desktop-pet','pending',''
 FROM _account_owners WHERE source_id='default' AND owner_user_id IS NOT NULL;

"""

FINISH = """

DELETE FROM platform_settings WHERE id='permission_policy';
INSERT OR REPLACE INTO platform_settings(id,payload,revision,created_at,updated_at)
SELECT 'account_defaults:'||m.owner_user_id,p.payload,p.revision,p.created_at,p.updated_at
FROM platform_settings p JOIN _account_owners m ON p.id='workspace_defaults:'||m.source_id
WHERE m.owner_user_id IS NOT NULL AND m.source_id=(SELECT source_id FROM _account_owners WHERE
    owner_user_id=m.owner_user_id ORDER BY ordinal LIMIT 1);
DELETE FROM platform_settings WHERE id LIKE 'workspace_defaults:%';
INSERT OR REPLACE INTO platform_settings(id,payload,revision,created_at,updated_at)
SELECT 'role_template:user',payload,revision,created_at,updated_at FROM platform_settings WHERE id=
    'role_template:member';
INSERT OR REPLACE INTO platform_settings(id,payload,revision,created_at,updated_at)
SELECT 'role_template:admin',payload,revision,created_at,updated_at FROM platform_settings WHERE
    id='role_template:super_admin';
DELETE FROM platform_settings WHERE id IN ('role_template:member','role_template:super_admin');
UPDATE platform_settings SET payload=json_set(payload,
 '$.admin.total',MAX(COALESCE(json_extract(payload,'$.admin.total'),4),
                     COALESCE(json_extract(payload,'$.super_admin.total'),4)),
 '$.admin.realtime_voice',MAX(COALESCE(json_extract(payload,'$.admin.realtime_voice'),2),
                     COALESCE(json_extract(payload,'$.super_admin.realtime_voice'),2)))
 WHERE id='runtime_quotas';
UPDATE platform_settings SET payload=json_remove(json_set(payload,'$.user',json_extract(payload,
    '$.member'),'$.generation_queue.user',COALESCE(json_extract(payload,'$.generation_queue.member'
    ),20)),'$.member','$.super_admin','$.workspace_total','$.generation_queue.member',
    '$.generation_queue.super_admin') WHERE id='runtime_quotas';
INSERT OR REPLACE INTO platform_settings(id,payload,revision,created_at,updated_at)
SELECT 'code_agents',json_object(
 'grants',json(COALESCE((SELECT json_group_array(json(value)) FROM (
   SELECT DISTINCT e.value FROM platform_settings p, json_each(p.payload,'$.grants') e
   WHERE p.id LIKE 'code_agents:%' OR p.id='code_agents')), '[]')),
 'managed',json(COALESCE((SELECT json_group_array(value) FROM (
   SELECT DISTINCT e.value FROM platform_settings p,json_each(p.payload,'$.managed') e
   WHERE p.id LIKE 'code_agents:%' OR p.id='code_agents')), '[]'))
),COALESCE((SELECT MAX(revision)+1 FROM platform_settings WHERE id LIKE 'code_agents:%'
    ),0),CURRENT_TIMESTAMP,CURRENT_TIMESTAMP;
DELETE FROM platform_settings WHERE id LIKE 'code_agents:%';
UPDATE model_template_sync_jobs SET role=CASE WHEN role IN ('admin','super_admin') THEN 'admin'
    ELSE 'user' END;
UPDATE thought_publications SET editable_platform_roles=(
 SELECT json_group_array(role) FROM (SELECT DISTINCT CASE WHEN value IN ('admin','super_admin')
    THEN 'admin' ELSE 'user' END role
 FROM json_each(thought_publications.editable_platform_roles))
);

UPDATE model_template_sync_items SET summary=json_set(summary,'$.retained',json_array(
 '保留 '||COALESCE(json_array_length(summary,'$.retained'),0)||' 个现有模型'));
UPDATE model_template_sync_jobs SET status='completed',revision=revision+1
 WHERE status IN ('preview','pending','running');
UPDATE model_template_sync_items SET status='skipped',error_message='账号升级后请重新预览'
 WHERE status='pending';

UPDATE model_providers SET origin='user' WHERE origin='role_template' AND template_key IS NULL;
UPDATE model_entries SET origin='user' WHERE origin='role_template' AND template_key IS NULL;
UPDATE model_suppliers SET origin='user' WHERE origin='role_template' AND template_key IS NULL;
CREATE TRIGGER presentation_examples_no_format_downgrade
BEFORE UPDATE OF document ON presentation_examples
WHEN json_extract(OLD.document, '$.version') >= 5
 AND coalesce(json_extract(NEW.document, '$.version'), 1) < 5
BEGIN
 SELECT RAISE(ABORT, 'presentation example format downgrade');
END;

CREATE TRIGGER presentation_projects_no_format_downgrade
BEFORE UPDATE OF document ON presentation_projects
WHEN json_extract(OLD.document, '$.version') >= 5
 AND coalesce(json_extract(NEW.document, '$.version'), 1) < 5
BEGIN
 SELECT RAISE(ABORT, 'presentation document format downgrade');
END;

CREATE TRIGGER presentation_templates_no_format_downgrade
BEFORE UPDATE OF definition ON presentation_templates
WHEN json_extract(OLD.definition, '$.version') >= 2
 AND coalesce(json_extract(NEW.definition, '$.version'), 1) < 2
BEGIN
 SELECT RAISE(ABORT, 'presentation template format downgrade');
END;
DROP TABLE workspace_invitations;
DROP TABLE workspace_memberships;
DROP TABLE workspaces;
DROP TABLE _account_ownership_guard;
DROP TABLE _account_owners;
"""

SQL = (
    PRELUDE
    + identity.SQL
    + models.SQL
    + knowledge.SQL
    + visual.SQL
    + galgame.SQL
    + media.SQL
    + animation.SQL
    + integrations.SQL
    + FINISH
)
