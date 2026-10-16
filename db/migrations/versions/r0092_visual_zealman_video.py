# ruff: noqa: E501
"""Allow workflow video tasks in Visual Workshop without changing existing records."""

MIGRATION_ID = "0092_visual_zealman_video"
SQL = """
PRAGMA legacy_alter_table = ON;
ALTER TABLE visual_generation_tasks RENAME TO visual_generation_tasks_r0092_old;
CREATE TABLE visual_generation_tasks (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL REFERENCES visual_workshop_projects(id) ON DELETE CASCADE,
  provider_id VARCHAR(36) REFERENCES model_providers(id) ON DELETE SET NULL,
  model_id VARCHAR(36) REFERENCES model_entries(id) ON DELETE SET NULL,
  provider_kind VARCHAR(24) NOT NULL CHECK (
    provider_kind IN ('senseaudio_image', 'volcengine_image', 'senseaudio_video', 'zealman_video', 'senseaudio_music', 'senseaudio_sfx')
  ),
  generation_kind VARCHAR(16) NOT NULL CHECK (generation_kind IN ('image', 'video', 'audio')),
  provider_name VARCHAR(120) NOT NULL,
  model_slug VARCHAR(160) NOT NULL,
  request_payload JSON NOT NULL DEFAULT '{}',
  provider_task_id VARCHAR(255),
  status VARCHAR(16) NOT NULL CHECK (
    status IN ('queued', 'submitting', 'pending', 'processing', 'completed', 'failed')
  ),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  error_message TEXT,
  result_url TEXT,
  result_asset_id VARCHAR(36) REFERENCES visual_assets(id) ON DELETE SET NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  workspace_id VARCHAR(36) NOT NULL DEFAULT 'default'
, canvas_node_id VARCHAR(64));
INSERT INTO visual_generation_tasks ("id", "project_id", "provider_id", "model_id", "provider_kind", "generation_kind", "provider_name", "model_slug", "request_payload", "provider_task_id", "status", "progress", "error_message", "result_url", "result_asset_id", "revision", "created_at", "updated_at", "completed_at", "workspace_id", "canvas_node_id") SELECT "id", "project_id", "provider_id", "model_id", "provider_kind", "generation_kind", "provider_name", "model_slug", "request_payload", "provider_task_id", "status", "progress", "error_message", "result_url", "result_asset_id", "revision", "created_at", "updated_at", "completed_at", "workspace_id", "canvas_node_id" FROM visual_generation_tasks_r0092_old;
DROP TABLE visual_generation_tasks_r0092_old;
CREATE INDEX ix_visual_generation_tasks_project_created
  ON visual_generation_tasks(project_id, created_at DESC);
CREATE INDEX ix_visual_generation_tasks_status_updated
  ON visual_generation_tasks(status, updated_at);
CREATE INDEX ix_visual_generation_tasks_provider
  ON visual_generation_tasks(provider_id, status);
CREATE INDEX ix_visual_generation_tasks_project_canvas_node_created
  ON visual_generation_tasks(project_id, canvas_node_id, created_at DESC);
PRAGMA legacy_alter_table = OFF;
"""
