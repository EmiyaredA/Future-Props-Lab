"""Store Video edit receipts, processing state and task relationships locally."""

SQL = """
CREATE TABLE video_editor_operation_batches (
    id VARCHAR(36) PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL REFERENCES video_editor_projects(id) ON DELETE CASCADE,
    request_id VARCHAR(64) NOT NULL,
    base_revision INTEGER NOT NULL,
    result_revision INTEGER NOT NULL,
    operations JSON NOT NULL,
    created_at DATETIME NOT NULL,
    UNIQUE (project_id, request_id)
);
CREATE INDEX ix_video_editor_operation_project_created
  ON video_editor_operation_batches(project_id, created_at);

CREATE TABLE video_editor_asset_metadata (
    asset_id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL REFERENCES video_editor_projects(id) ON DELETE CASCADE,
    processing_status VARCHAR(16) NOT NULL,
    probe JSON NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    proxy_filename VARCHAR(255),
    thumbnail_filename VARCHAR(255),
    waveform_filename VARCHAR(255),
    error TEXT,
    default_effects JSON NOT NULL,
    revision INTEGER NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);
CREATE INDEX ix_video_editor_asset_project
  ON video_editor_asset_metadata(project_id, created_at);

CREATE TABLE video_editor_tasks (
    id VARCHAR(36) PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL REFERENCES video_editor_projects(id) ON DELETE CASCADE,
    request_id VARCHAR(64) NOT NULL,
    kind VARCHAR(16) NOT NULL,
    status VARCHAR(16) NOT NULL,
    progress INTEGER NOT NULL,
    request_payload JSON NOT NULL,
    snapshot_document JSON NOT NULL,
    result_detail JSON NOT NULL,
    output_asset_id VARCHAR(36),
    error TEXT,
    cancel_requested BOOLEAN NOT NULL,
    revision INTEGER NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    started_at DATETIME,
    finished_at DATETIME,
    UNIQUE (project_id, request_id)
);
CREATE INDEX ix_video_editor_tasks_status_created ON video_editor_tasks(status, created_at);
CREATE INDEX ix_video_editor_tasks_project_created ON video_editor_tasks(project_id, created_at);
"""
