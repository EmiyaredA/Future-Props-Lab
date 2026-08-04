MIGRATION_ID = "r0015_model_test_generation_assets"

SQL = r"""
CREATE TABLE model_test_generation_assets (
  id VARCHAR(36) PRIMARY KEY,
  task_id VARCHAR(36)
    REFERENCES model_test_generation_tasks(id) ON DELETE CASCADE,
  role VARCHAR(24) CHECK (
    role IS NULL OR role IN ('reference_image', 'reference_audio', 'reference_video')
  ),
  position INTEGER CHECK (position IS NULL OR position >= 0),
  original_filename VARCHAR(255) NOT NULL,
  storage_key VARCHAR(64) NOT NULL UNIQUE,
  media_kind VARCHAR(16) NOT NULL CHECK (media_kind IN ('image', 'audio', 'video')),
  mime_type VARCHAR(120) NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  legacy_visual_asset_id VARCHAR(36),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (task_id IS NULL AND role IS NULL AND position IS NULL)
    OR (task_id IS NOT NULL AND role IS NOT NULL AND position IS NOT NULL)
  ),
  UNIQUE (task_id, role, position)
);
CREATE INDEX ix_model_test_generation_assets_task
  ON model_test_generation_assets(task_id, role, position);
CREATE INDEX ix_model_test_generation_assets_draft_created
  ON model_test_generation_assets(created_at) WHERE task_id IS NULL;
"""
