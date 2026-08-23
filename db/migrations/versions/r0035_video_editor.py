# ruff: noqa: E501

MIGRATION_ID = "r0035_video_editor"

SQL = r"""
CREATE TABLE video_editor_projects (
  id VARCHAR(36) PRIMARY KEY,
  workspace_id VARCHAR(36) NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE,
  title VARCHAR(120) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_video_editor_projects_workspace_updated ON video_editor_projects(workspace_id, updated_at);

ALTER TABLE visual_assets ADD COLUMN video_editor_project_id VARCHAR(36) REFERENCES video_editor_projects(id) ON DELETE CASCADE;
CREATE INDEX ix_visual_assets_video_editor_project ON visual_assets(video_editor_project_id, updated_at);

CREATE TABLE video_editor_timelines (
  project_id VARCHAR(36) PRIMARY KEY REFERENCES video_editor_projects(id) ON DELETE CASCADE,
  document JSON NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE video_editor_operation_batches (
  id VARCHAR(36) PRIMARY KEY,
  workspace_id VARCHAR(36) NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id VARCHAR(36) NOT NULL REFERENCES video_editor_projects(id) ON DELETE CASCADE,
  request_id VARCHAR(64) NOT NULL,
  base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
  result_revision INTEGER NOT NULL CHECK (result_revision >= 0),
  operations JSON NOT NULL DEFAULT '[]',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, request_id)
);
CREATE INDEX ix_video_editor_operation_project_created ON video_editor_operation_batches(project_id, created_at);

CREATE TABLE video_editor_asset_metadata (
  asset_id VARCHAR(36) PRIMARY KEY REFERENCES visual_assets(id) ON DELETE CASCADE,
  project_id VARCHAR(36) NOT NULL REFERENCES video_editor_projects(id) ON DELETE CASCADE,
  processing_status VARCHAR(16) NOT NULL DEFAULT 'queued' CHECK (processing_status IN ('queued', 'processing', 'ready', 'failed')),
  probe JSON NOT NULL DEFAULT '{}',
  fingerprint VARCHAR(64) NOT NULL DEFAULT '',
  proxy_filename VARCHAR(255),
  thumbnail_filename VARCHAR(255),
  waveform_filename VARCHAR(255),
  error TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_video_editor_asset_project ON video_editor_asset_metadata(project_id, created_at);

CREATE TABLE video_editor_tasks (
  id VARCHAR(36) PRIMARY KEY,
  workspace_id VARCHAR(36) NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id VARCHAR(36) NOT NULL REFERENCES video_editor_projects(id) ON DELETE CASCADE,
  request_id VARCHAR(64) NOT NULL,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('media', 'render')),
  status VARCHAR(16) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  request_payload JSON NOT NULL DEFAULT '{}',
  snapshot_document JSON NOT NULL DEFAULT '{}',
  result_detail JSON NOT NULL DEFAULT '{}',
  output_asset_id VARCHAR(36) REFERENCES visual_assets(id) ON DELETE SET NULL,
  error TEXT,
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  UNIQUE(project_id, request_id)
);
CREATE INDEX ix_video_editor_tasks_status_created ON video_editor_tasks(status, created_at);
CREATE INDEX ix_video_editor_tasks_project_created ON video_editor_tasks(project_id, created_at);
"""
