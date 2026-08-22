MIGRATION_ID = "r0029_galgame_video_exports"

SQL = r"""
CREATE TABLE galgame_video_export_tasks (
  id VARCHAR(36) PRIMARY KEY,
  workspace_id VARCHAR(36) NOT NULL DEFAULT 'default'
    REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id VARCHAR(36) NOT NULL
    REFERENCES galgame_workshop_projects(id) ON DELETE CASCADE,
  snapshot_id VARCHAR(36) NOT NULL
    REFERENCES galgame_story_snapshots(id) ON DELETE RESTRICT,
  request_id VARCHAR(64) NOT NULL,
  story_revision INTEGER NOT NULL CHECK (story_revision >= 0),
  request_payload JSON NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  result_detail JSON NOT NULL DEFAULT '{}',
  output_asset_id VARCHAR(36) REFERENCES visual_assets(id) ON DELETE SET NULL,
  cancel_requested BOOLEAN NOT NULL DEFAULT 0,
  error TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  UNIQUE (workspace_id, project_id, request_id)
);
CREATE INDEX ix_galgame_video_export_tasks_project_status
  ON galgame_video_export_tasks(project_id, status, created_at);
"""
