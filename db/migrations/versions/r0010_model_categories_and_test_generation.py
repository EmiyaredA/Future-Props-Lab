MIGRATION_ID = "r0010_model_categories_and_test_generation"

SQL = r"""
ALTER TABLE model_entries
ADD COLUMN categories JSON NOT NULL DEFAULT '[]';

CREATE TABLE model_test_generation_tasks (
  id VARCHAR(36) PRIMARY KEY,
  provider_id VARCHAR(36)
    REFERENCES model_providers(id) ON DELETE SET NULL,
  model_id VARCHAR(36)
    REFERENCES model_entries(id) ON DELETE SET NULL,
  provider_kind VARCHAR(24) NOT NULL CHECK (
    provider_kind IN ('senseaudio_image', 'senseaudio_video')
  ),
  generation_kind VARCHAR(16) NOT NULL CHECK (generation_kind IN ('image', 'video')),
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
  result_storage_key VARCHAR(64),
  result_filename VARCHAR(255),
  result_mime_type VARCHAR(120),
  result_byte_size INTEGER,
  log_id VARCHAR(36) REFERENCES llm_call_logs(id) ON DELETE SET NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);
CREATE INDEX ix_model_test_generation_status_updated
  ON model_test_generation_tasks(status, updated_at);
CREATE INDEX ix_model_test_generation_model_created
  ON model_test_generation_tasks(model_id, created_at DESC);
"""
