MIGRATION_ID = "r0041_visual_generation_batches"

SQL = r"""
CREATE TABLE visual_generation_batches (
  id VARCHAR(36) PRIMARY KEY,
  workspace_id VARCHAR(36) NOT NULL DEFAULT 'default',
  project_id VARCHAR(36) NOT NULL REFERENCES visual_workshop_projects(id) ON DELETE CASCADE,
  grid_size INTEGER NOT NULL CHECK (grid_size IN (4, 9)),
  grid_output VARCHAR(16) NOT NULL CHECK (grid_output IN ('nodes', 'composite')),
  child_task_ids JSON NOT NULL DEFAULT '[]',
  status VARCHAR(16) NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  completed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  result_asset_id VARCHAR(36) REFERENCES visual_assets(id) ON DELETE SET NULL,
  error_message TEXT,
  generation_node_id VARCHAR(64),
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);
CREATE INDEX ix_visual_generation_batches_project_created
  ON visual_generation_batches(project_id, created_at DESC);
CREATE INDEX ix_visual_generation_batches_status_updated
  ON visual_generation_batches(status, updated_at);
"""
