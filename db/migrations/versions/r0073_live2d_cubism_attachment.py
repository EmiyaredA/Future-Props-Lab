"""Workspace scoped Cubism runtime attachments for native characters."""

MIGRATION_ID = "r0073_live2d_cubism_attachment"
SQL = """
CREATE TABLE live2d_cubism_attachments (
 project_id VARCHAR(36) PRIMARY KEY REFERENCES live2d_projects(id) ON DELETE CASCADE,
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 sha256 VARCHAR(64) NOT NULL,
 metadata JSON NOT NULL,
 state_bindings JSON NOT NULL,
 created_at DATETIME NOT NULL
);
CREATE INDEX ix_live2d_cubism_workspace ON live2d_cubism_attachments(workspace_id);
"""
