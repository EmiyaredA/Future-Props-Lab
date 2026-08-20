MIGRATION_ID = "r0024_model_test_transcription"

SQL = r"""
CREATE TABLE model_test_transcription_tasks (
  id VARCHAR(36) PRIMARY KEY,
  workspace_id VARCHAR(36) NOT NULL DEFAULT 'default'
    REFERENCES workspaces(id) ON DELETE CASCADE,
  provider_id VARCHAR(36) REFERENCES model_providers(id) ON DELETE SET NULL,
  model_id VARCHAR(36) REFERENCES model_entries(id) ON DELETE SET NULL,
  provider_kind VARCHAR(24) NOT NULL
    CHECK (provider_kind IN ('openai', 'senseaudio_asr')),
  provider_name VARCHAR(120) NOT NULL,
  model_slug VARCHAR(160) NOT NULL,
  source_kind VARCHAR(16) NOT NULL CHECK (source_kind IN ('upload', 'library')),
  source_asset_id VARCHAR(36) REFERENCES visual_assets(id) ON DELETE SET NULL,
  input_storage_key VARCHAR(64) NOT NULL UNIQUE,
  input_filename VARCHAR(255) NOT NULL,
  input_mime_type VARCHAR(120) NOT NULL,
  input_byte_size INTEGER NOT NULL CHECK (input_byte_size > 0 AND input_byte_size <= 10485760),
  language VARCHAR(8) NOT NULL DEFAULT 'auto' CHECK (language IN ('auto', 'zh', 'ja')),
  status VARCHAR(16) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  result_text TEXT,
  result_segments JSON NOT NULL DEFAULT '[]',
  error_message TEXT,
  log_id VARCHAR(36) REFERENCES llm_call_logs(id) ON DELETE SET NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP
);
CREATE INDEX ix_model_test_transcription_workspace_created
  ON model_test_transcription_tasks(workspace_id, created_at DESC);
CREATE INDEX ix_model_test_transcription_status_created
  ON model_test_transcription_tasks(status, created_at);
CREATE INDEX ix_model_test_transcription_model_created
  ON model_test_transcription_tasks(model_id, created_at DESC);
"""
