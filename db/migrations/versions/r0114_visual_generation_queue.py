"""Durable waiting admissions and cancellation without changing existing ownership."""

MIGRATION_ID = "0114_visual_generation_queue"
SQL = """
PRAGMA legacy_alter_table = ON;
ALTER TABLE visual_generation_tasks RENAME TO visual_generation_tasks_r0114_old;
CREATE TABLE visual_generation_tasks (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL REFERENCES visual_workshop_projects(id) ON DELETE CASCADE,
  provider_id VARCHAR(36) REFERENCES model_providers(id) ON DELETE SET NULL,
  model_id VARCHAR(36) REFERENCES model_entries(id) ON DELETE SET NULL,
  provider_kind VARCHAR(24) NOT NULL CHECK (
    provider_kind IN ('senseaudio_image', 'volcengine_image', 'senseaudio_video',
'volcengine_video', 'zealman_video', 'autodl_video', 'senseaudio_music', 'senseaudio_sfx')
  ),
  generation_kind VARCHAR(16) NOT NULL CHECK (generation_kind IN ('image', 'video', 'audio')),
  provider_name VARCHAR(120) NOT NULL,
  model_slug VARCHAR(160) NOT NULL,
  request_payload JSON NOT NULL DEFAULT '{}',
  provider_task_id VARCHAR(255),
  status VARCHAR(16) NOT NULL CHECK (
    status IN ('queued', 'submitting', 'pending', 'processing', 'completed', 'failed', 'cancelled')
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
, canvas_node_id VARCHAR(64), execution_info JSON, submitted_at TIMESTAMP);
INSERT INTO visual_generation_tasks ("id", "project_id", "provider_id", "model_id",
"provider_kind", "generation_kind", "provider_name", "model_slug", "request_payload",
"provider_task_id", "status", "progress", "error_message", "result_url", "result_asset_id",
"revision", "created_at", "updated_at", "completed_at", "workspace_id", "canvas_node_id",
"execution_info") SELECT "id", "project_id", "provider_id", "model_id", "provider_kind",
"generation_kind", "provider_name", "model_slug", "request_payload", "provider_task_id",
"status", "progress", "error_message", "result_url", "result_asset_id", "revision",
"created_at", "updated_at", "completed_at", "workspace_id", "canvas_node_id", "execution_info"
FROM visual_generation_tasks_r0114_old;
DROP TABLE visual_generation_tasks_r0114_old;
UPDATE visual_generation_tasks SET submitted_at = created_at WHERE provider_task_id IS NOT NULL;
CREATE INDEX ix_visual_generation_tasks_project_created
  ON visual_generation_tasks(project_id, created_at DESC);
CREATE INDEX ix_visual_generation_tasks_status_updated
  ON visual_generation_tasks(status, updated_at);
CREATE INDEX ix_visual_generation_tasks_provider
  ON visual_generation_tasks(provider_id, status);
CREATE INDEX ix_visual_generation_tasks_project_canvas_node_created
  ON visual_generation_tasks(project_id, canvas_node_id, created_at DESC);
PRAGMA legacy_alter_table = OFF;

PRAGMA legacy_alter_table = ON;
ALTER TABLE visual_generation_batches RENAME TO visual_generation_batches_r0114_old;
CREATE TABLE visual_generation_batches (
  id VARCHAR(36) PRIMARY KEY,
  workspace_id VARCHAR(36) NOT NULL DEFAULT 'default',
  project_id VARCHAR(36) NOT NULL REFERENCES visual_workshop_projects(id) ON DELETE CASCADE,
  grid_size INTEGER NOT NULL CHECK (grid_size IN (4, 9)),
  grid_output VARCHAR(16) NOT NULL CHECK (grid_output IN ('nodes', 'composite')),
  child_task_ids JSON NOT NULL DEFAULT '[]',
  status VARCHAR(16) NOT NULL CHECK (
    status IN ('queued', 'processing', 'completed', 'failed', 'cancelled')
  ),
  completed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  result_asset_id VARCHAR(36) REFERENCES visual_assets(id) ON DELETE SET NULL,
  error_message TEXT,
  generation_node_id VARCHAR(64),
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  batch_kind VARCHAR(16) NOT NULL DEFAULT 'generation'
    CHECK (batch_kind IN ('generation', 'composition')),
  source_items JSON NOT NULL DEFAULT '[]',
  cancelled_count INTEGER NOT NULL DEFAULT 0
);

INSERT INTO visual_generation_batches (
  id, workspace_id, project_id, grid_size, grid_output, child_task_ids, status,
  completed_count, failed_count, result_asset_id, error_message, generation_node_id,
  revision, created_at, updated_at, completed_at, batch_kind, source_items
) SELECT
  id, workspace_id, project_id, grid_size, grid_output, child_task_ids, status,
  completed_count, failed_count, result_asset_id, error_message, generation_node_id,
  revision, created_at, updated_at, completed_at, batch_kind, source_items
FROM visual_generation_batches_r0114_old;
DROP TABLE visual_generation_batches_r0114_old;
CREATE INDEX ix_visual_generation_batches_project_created
  ON visual_generation_batches(project_id, created_at DESC);
CREATE INDEX ix_visual_generation_batches_status_updated
  ON visual_generation_batches(status, updated_at);
PRAGMA legacy_alter_table = OFF;

ALTER TABLE runtime_admissions ADD COLUMN waiting BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE runtime_admissions ADD COLUMN queue_task_id VARCHAR(36)
 REFERENCES visual_generation_tasks(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX ix_runtime_admissions_queue_task ON runtime_admissions(queue_task_id);
CREATE INDEX ix_runtime_admissions_waiting_user
 ON runtime_admissions(waiting, released_at, user_id, created_at);
"""
