"""Official publications use ordinary notes; imports are explicit and recoverable."""

MIGRATION_ID = "0084_unified_official_publications"
SQL = """
ALTER TABLE thought_publications ADD COLUMN is_official BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE thought_publications ADD COLUMN read_only BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE thought_publications ADD COLUMN editable_platform_roles JSON NOT NULL DEFAULT '[]';
CREATE TABLE thought_official_sources (
 note_id VARCHAR(36) PRIMARY KEY REFERENCES thought_notes(id) ON DELETE CASCADE,
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 library_key VARCHAR(80) NOT NULL, document_key VARCHAR(80) NOT NULL
);
CREATE INDEX ix_thought_official_sources_workspace_id ON thought_official_sources(workspace_id);
CREATE INDEX ix_thought_official_sources_library_key ON thought_official_sources(library_key);
CREATE TABLE thought_official_import_receipts (
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_id VARCHAR(36) NOT NULL, package_version VARCHAR(64) NOT NULL,
 result JSON NOT NULL, created_at DATETIME NOT NULL,
 PRIMARY KEY(workspace_id,user_id,request_id)
);
"""
