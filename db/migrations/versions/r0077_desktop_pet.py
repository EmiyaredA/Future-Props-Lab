"""Workspace-scoped desktop pet projects with frozen character snapshots."""

MIGRATION_ID = "r0077_desktop_pet"
SQL = """
CREATE TABLE desktop_pet_projects (
 id VARCHAR(36) PRIMARY KEY,
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 source_project_id VARCHAR(36) NOT NULL,
 source_revision INTEGER NOT NULL,
 source_title VARCHAR(120) NOT NULL,
 title VARCHAR(120) NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0,
 character JSON NOT NULL,
 config JSON NOT NULL,
 created_at DATETIME NOT NULL,
 updated_at DATETIME NOT NULL
);
CREATE INDEX ix_desktop_pet_workspace_updated ON desktop_pet_projects(workspace_id, updated_at);
"""
