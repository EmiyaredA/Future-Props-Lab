"""Workspace-scoped motion compositions, assets and render tasks."""

MIGRATION_ID = "r0066_motion_compositor"

SQL = """
CREATE TABLE motion_compositor_projects (
 id VARCHAR(36) PRIMARY KEY,
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 title VARCHAR(120) NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0,
 created_at DATETIME NOT NULL,
 updated_at DATETIME NOT NULL
);
CREATE INDEX ix_motion_projects_workspace_updated
 ON motion_compositor_projects(workspace_id, updated_at);

ALTER TABLE visual_assets ADD COLUMN motion_compositor_project_id VARCHAR(36)
 REFERENCES motion_compositor_projects(id) ON DELETE CASCADE;
CREATE INDEX ix_visual_assets_motion_project
 ON visual_assets(motion_compositor_project_id, updated_at);

CREATE TABLE motion_compositor_documents (
 project_id VARCHAR(36) PRIMARY KEY REFERENCES motion_compositor_projects(id) ON DELETE CASCADE,
 document JSON NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0,
 updated_at DATETIME NOT NULL
);

CREATE TABLE motion_compositor_operation_batches (
 id VARCHAR(36) PRIMARY KEY,
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 project_id VARCHAR(36) NOT NULL REFERENCES motion_compositor_projects(id) ON DELETE CASCADE,
 request_id VARCHAR(64) NOT NULL,
 base_revision INTEGER NOT NULL,
 result_revision INTEGER NOT NULL,
 operations JSON NOT NULL,
 result_document JSON NOT NULL,
 created_at DATETIME NOT NULL,
 UNIQUE(project_id, request_id)
);

CREATE TABLE motion_compositor_tasks (
 id VARCHAR(36) PRIMARY KEY,
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 project_id VARCHAR(36) NOT NULL REFERENCES motion_compositor_projects(id) ON DELETE CASCADE,
 request_id VARCHAR(64) NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'queued',
 progress INTEGER NOT NULL DEFAULT 0,
 request_payload JSON NOT NULL,
 snapshot_document JSON NOT NULL,
 outputs JSON NOT NULL DEFAULT '{}',
 error TEXT,
 cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
 created_at DATETIME NOT NULL,
 updated_at DATETIME NOT NULL,
 UNIQUE(project_id, request_id)
);
CREATE INDEX ix_motion_tasks_status_created ON motion_compositor_tasks(status, created_at);
"""
