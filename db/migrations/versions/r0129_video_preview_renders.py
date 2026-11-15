"""Allow disposable preview tasks while preserving all existing task records."""

MIGRATION_ID = "0129_video_preview_renders"

SQL = """
CREATE TABLE video_editor_tasks__preview_upgrade (
  id VARCHAR(36) PRIMARY KEY,
  owner_user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id VARCHAR(36) NOT NULL REFERENCES video_editor_projects(id) ON DELETE CASCADE,
  request_id VARCHAR(64) NOT NULL,
  kind VARCHAR(16) NOT NULL CHECK (kind IN
    ('media', 'render', 'segment_export', 'asset_bake', 'clip_merge', 'preview_render')),
  status VARCHAR(16) NOT NULL DEFAULT 'queued' CHECK
    (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
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
INSERT INTO video_editor_tasks__preview_upgrade SELECT * FROM video_editor_tasks;
DROP TABLE video_editor_tasks;
ALTER TABLE video_editor_tasks__preview_upgrade RENAME TO video_editor_tasks;
CREATE INDEX ix_video_editor_tasks_status_created ON video_editor_tasks(status, created_at);
CREATE INDEX ix_video_editor_tasks_project_created ON video_editor_tasks(project_id, created_at);
"""
