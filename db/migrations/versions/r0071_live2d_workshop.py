"""Native character authoring projects, immutable assets and export snapshots."""

MIGRATION_ID = "r0071_live2d_workshop"
SQL = """
CREATE TABLE live2d_projects (
 id VARCHAR(36) PRIMARY KEY,
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 title VARCHAR(120) NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
 document JSON NOT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL
);
CREATE INDEX ix_live2d_workspace_updated ON live2d_projects(workspace_id, updated_at);
CREATE TABLE live2d_assets (
 id VARCHAR(36) PRIMARY KEY,
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 project_id VARCHAR(36) NOT NULL REFERENCES live2d_projects(id) ON DELETE CASCADE,
 name VARCHAR(255) NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
 created_at DATETIME NOT NULL
);
CREATE INDEX ix_live2d_assets_project_id ON live2d_assets(project_id);
CREATE TABLE live2d_exports (
 id VARCHAR(36) PRIMARY KEY,
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 project_id VARCHAR(36) NOT NULL REFERENCES live2d_projects(id) ON DELETE CASCADE,
 request_id VARCHAR(64) NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'queued',
 progress INTEGER NOT NULL DEFAULT 0, payload JSON NOT NULL, snapshot JSON NOT NULL,
 error TEXT, cancel_requested BOOLEAN NOT NULL DEFAULT FALSE, created_at DATETIME NOT NULL,
 UNIQUE(project_id, request_id)
);
CREATE INDEX ix_live2d_exports_project_id ON live2d_exports(project_id);
"""
