"""Keep export task intents after project deletion until Rendering settles cleanup."""

SQL = """
CREATE TABLE motion_compositor_tasks (
    id VARCHAR(36) PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL REFERENCES motion_compositor_projects(id) ON DELETE CASCADE,
    request_id VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL,
    progress INTEGER NOT NULL,
    request_payload JSON NOT NULL,
    snapshot_document JSON NOT NULL,
    outputs JSON NOT NULL,
    error TEXT,
    cancel_requested BOOLEAN NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE(project_id, request_id)
);
CREATE INDEX ix_motion_tasks_status_created ON motion_compositor_tasks(status, created_at);

CREATE TABLE motion_export_bindings (
    task_id VARCHAR(36) PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    remote_id VARCHAR(32) NOT NULL UNIQUE,
    request_path VARCHAR(512) NOT NULL,
    assertion TEXT NOT NULL,
    frozen_request JSON NOT NULL,
    checked_at DATETIME NOT NULL
);
CREATE INDEX ix_motion_export_bindings_checked ON motion_export_bindings(checked_at);
"""
