"""Reusable document content, reference indexes and account reading preferences."""

MIGRATION_ID = "0080_thought_knowledge_tools"
SQL = """
CREATE TABLE thought_document_references (
 note_id VARCHAR(36) NOT NULL REFERENCES thought_notes(id) ON DELETE CASCADE,
 target_id VARCHAR(36) NOT NULL,
 PRIMARY KEY(note_id, target_id)
);
CREATE INDEX ix_thought_reference_target ON thought_document_references(target_id);
CREATE TABLE thought_templates (
 id VARCHAR(36) PRIMARY KEY,
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 name VARCHAR(120) NOT NULL, description TEXT NOT NULL, document JSON NOT NULL,
 tags JSON NOT NULL, schema_version INTEGER NOT NULL, revision INTEGER NOT NULL,
 created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL
);
CREATE INDEX ix_thought_templates_workspace ON thought_templates(workspace_id);
CREATE TABLE thought_template_assets (
 template_id VARCHAR(36) NOT NULL REFERENCES thought_templates(id) ON DELETE CASCADE,
 asset_id VARCHAR(36) NOT NULL REFERENCES visual_assets(id) ON DELETE RESTRICT,
 PRIMARY KEY(template_id, asset_id)
);
CREATE INDEX ix_thought_template_assets_asset ON thought_template_assets(asset_id);
CREATE TABLE thought_checkpoints (
 id VARCHAR(36) PRIMARY KEY,
 note_id VARCHAR(36) NOT NULL REFERENCES thought_notes(id) ON DELETE CASCADE,
 history_id VARCHAR(36) NOT NULL REFERENCES thought_note_history(id) ON DELETE CASCADE,
 name VARCHAR(120) NOT NULL, revision INTEGER NOT NULL, created_at DATETIME NOT NULL
);
CREATE TABLE thought_saved_filters (
 id VARCHAR(36) PRIMARY KEY,
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name VARCHAR(120) NOT NULL, criteria JSON NOT NULL, revision INTEGER NOT NULL
);
CREATE INDEX ix_thought_filters_owner ON thought_saved_filters(workspace_id, user_id);
CREATE TABLE thought_reading_states (
 id VARCHAR(36) PRIMARY KEY,
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 resource_id VARCHAR(200) NOT NULL, title VARCHAR(240) NOT NULL,
 position JSON NOT NULL, visited_at DATETIME NOT NULL,
 UNIQUE(workspace_id,user_id,resource_id)
);
CREATE INDEX ix_thought_reading_owner ON thought_reading_states(workspace_id,user_id,visited_at);
"""
