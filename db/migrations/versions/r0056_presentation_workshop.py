"""Workspace presentation documents and managed public image references."""

MIGRATION_ID = "0056_presentation_workshop"
SQL = """
CREATE TABLE presentation_projects (
 id VARCHAR(36) PRIMARY KEY,
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 title VARCHAR(120) NOT NULL, document JSON NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0,
 created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL
);
CREATE INDEX ix_presentation_projects_workspace_updated
 ON presentation_projects(workspace_id, updated_at);
CREATE TABLE presentation_asset_references (
 project_id VARCHAR(36) NOT NULL REFERENCES presentation_projects(id) ON DELETE CASCADE,
 asset_id VARCHAR(36) NOT NULL REFERENCES visual_assets(id) ON DELETE RESTRICT,
 PRIMARY KEY(project_id, asset_id)
);
CREATE INDEX ix_presentation_asset_references_asset
 ON presentation_asset_references(asset_id);
"""
