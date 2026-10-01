"""Allow a desktop pet to own an imported Coopanion whale snapshot."""

MIGRATION_ID = "r0078_desktop_pet_whale"
SQL = """
ALTER TABLE desktop_pet_projects RENAME TO desktop_pet_projects_legacy;
CREATE TABLE desktop_pet_projects (
 id VARCHAR(36) PRIMARY KEY,
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 source_type VARCHAR(32) NOT NULL DEFAULT 'live2d',
 source_project_id VARCHAR(36),
 source_revision INTEGER,
 source_title VARCHAR(120) NOT NULL,
 title VARCHAR(120) NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0,
 character JSON,
 whale_model JSON,
 whale_assets JSON,
 config JSON NOT NULL,
 created_at DATETIME NOT NULL,
 updated_at DATETIME NOT NULL
);
INSERT INTO desktop_pet_projects (
 id, workspace_id, source_type, source_project_id, source_revision, source_title,
 title, revision, character, whale_model, whale_assets, config, created_at, updated_at
)
SELECT id, workspace_id, 'live2d', source_project_id, source_revision, source_title,
 title, revision, character, NULL, NULL, config, created_at, updated_at
FROM desktop_pet_projects_legacy;
DROP TABLE desktop_pet_projects_legacy;
CREATE INDEX ix_desktop_pet_workspace_updated ON desktop_pet_projects(workspace_id, updated_at);
"""
