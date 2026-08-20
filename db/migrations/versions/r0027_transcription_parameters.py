MIGRATION_ID = "r0027_transcription_parameters"

SQL = r"""
PRAGMA legacy_alter_table = ON;

ALTER TABLE model_test_transcription_tasks
RENAME TO model_test_transcription_tasks_r0027_old;

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
  input_byte_size INTEGER NOT NULL
    CHECK (input_byte_size > 0 AND input_byte_size <= 104857600),
  language VARCHAR(128) NOT NULL DEFAULT 'auto',
  request_options JSON NOT NULL DEFAULT '{}',
  status VARCHAR(16) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  result_text TEXT,
  result_segments JSON NOT NULL DEFAULT '[]',
  result_detail JSON NOT NULL DEFAULT '{}',
  error_message TEXT,
  log_id VARCHAR(36) REFERENCES llm_call_logs(id) ON DELETE SET NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP
);

INSERT INTO model_test_transcription_tasks (
  id, workspace_id, provider_id, model_id, provider_kind, provider_name, model_slug,
  source_kind, source_asset_id, input_storage_key, input_filename, input_mime_type,
  input_byte_size, language, request_options, status, result_text, result_segments,
  result_detail, error_message, log_id, revision, created_at, updated_at, started_at,
  completed_at
)
SELECT
  id, workspace_id, provider_id, model_id, provider_kind, provider_name, model_slug,
  source_kind, source_asset_id, input_storage_key, input_filename, input_mime_type,
  input_byte_size, language,
  json_object(
    'language', language,
    'target_language', NULL,
    'enable_word_timestamps', 0,
    'enable_text_edit', CASE WHEN model_slug = 'pro-asr' THEN 1 ELSE 0 END,
    'enable_speaker_diarization', CASE WHEN provider_kind = 'senseaudio_asr' THEN 1 ELSE 0 END,
    'max_speakers', NULL,
    'enable_punctuation',
      CASE WHEN provider_kind = 'senseaudio_asr' AND model_slug != 'pro-asr' THEN 1 ELSE 0 END,
    'hotwords', NULL,
    'abbreviations', 0
  ),
  status, result_text, result_segments, '{}', error_message, log_id, revision,
  created_at, updated_at, started_at, completed_at
FROM model_test_transcription_tasks_r0027_old;

DROP TABLE model_test_transcription_tasks_r0027_old;

CREATE INDEX ix_model_test_transcription_workspace_created
  ON model_test_transcription_tasks(workspace_id, created_at DESC);
CREATE INDEX ix_model_test_transcription_status_created
  ON model_test_transcription_tasks(status, created_at);
CREATE INDEX ix_model_test_transcription_model_created
  ON model_test_transcription_tasks(model_id, created_at DESC);

PRAGMA legacy_alter_table = OFF;
"""
