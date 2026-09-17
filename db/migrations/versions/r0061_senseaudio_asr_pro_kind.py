# ruff: noqa: E501

MIGRATION_ID = "r0061_senseaudio_asr_pro_kind"

SQL = r"""
PRAGMA legacy_alter_table = ON;

ALTER TABLE model_providers RENAME TO model_providers_r0061_old;
CREATE TABLE model_providers (
  id VARCHAR(36) PRIMARY KEY,
  workspace_id VARCHAR(36) NOT NULL DEFAULT 'default',
  origin VARCHAR(20) NOT NULL DEFAULT 'user',
  template_key VARCHAR(100),
  name VARCHAR(120) NOT NULL,
  supplier_id VARCHAR(36) REFERENCES model_suppliers(id) ON DELETE RESTRICT,
  kind VARCHAR(24) NOT NULL CHECK (
    kind IN (
      'openai', 'anthropic', 'senseaudio_image', 'senseaudio_video',
      'senseaudio_asr', 'senseaudio_asr_pro', 'senseaudio_realtime',
      'senseaudio_music', 'senseaudio_sfx'
    )
  ),
  base_url VARCHAR(512) NOT NULL DEFAULT '',
  api_key_ciphertext TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO model_providers (
  id, workspace_id, origin, template_key, name, supplier_id, kind, base_url,
  api_key_ciphertext, enabled, sort_order, created_at, updated_at
)
SELECT
  id, workspace_id, origin, template_key, name, supplier_id, kind, base_url,
  api_key_ciphertext, enabled, sort_order, created_at, updated_at
FROM model_providers_r0061_old;
DROP TABLE model_providers_r0061_old;
CREATE INDEX ix_model_providers_workspace ON model_providers(workspace_id, sort_order);
CREATE INDEX ix_model_providers_supplier_id ON model_providers(supplier_id);
CREATE UNIQUE INDEX uq_provider_template ON model_providers(workspace_id, template_key);

ALTER TABLE model_test_transcription_tasks
RENAME TO model_test_transcription_tasks_r0061_old;
CREATE TABLE model_test_transcription_tasks (
  id VARCHAR(36) PRIMARY KEY,
  workspace_id VARCHAR(36) NOT NULL DEFAULT 'default'
    REFERENCES workspaces(id) ON DELETE CASCADE,
  provider_id VARCHAR(36) REFERENCES model_providers(id) ON DELETE SET NULL,
  model_id VARCHAR(36) REFERENCES model_entries(id) ON DELETE SET NULL,
  provider_kind VARCHAR(24) NOT NULL
    CHECK (provider_kind IN ('openai', 'senseaudio_asr', 'senseaudio_asr_pro')),
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
INSERT INTO model_test_transcription_tasks
SELECT * FROM model_test_transcription_tasks_r0061_old;
DROP TABLE model_test_transcription_tasks_r0061_old;
CREATE INDEX ix_model_test_transcription_workspace_created
  ON model_test_transcription_tasks(workspace_id, created_at DESC);
CREATE INDEX ix_model_test_transcription_status_created
  ON model_test_transcription_tasks(status, created_at);
CREATE INDEX ix_model_test_transcription_model_created
  ON model_test_transcription_tasks(model_id, created_at DESC);

PRAGMA legacy_alter_table = OFF;

UPDATE model_providers
SET kind = 'senseaudio_asr_pro',
    updated_at = CURRENT_TIMESTAMP
WHERE kind = 'senseaudio_asr'
  AND (
    rtrim(base_url, '/') LIKE '%/api/v2/asr/pro'
    OR instr(base_url, '#pro-asr') > 0
  );

UPDATE model_test_transcription_tasks
SET provider_kind = 'senseaudio_asr_pro'
WHERE provider_kind = 'senseaudio_asr'
  AND (
    model_slug = 'pro-asr'
    OR provider_id IN (
      SELECT id FROM model_providers WHERE kind = 'senseaudio_asr_pro'
    )
  );

CREATE TEMP TABLE r0061_pro_asr_sources AS
SELECT
  provider.workspace_id,
  provider.api_key_ciphertext,
  provider.enabled,
  CASE
    WHEN provider.workspace_id = 'default' THEN 'f0000000-0000-4000-8000-000000000006'
    ELSE
      substr(replace(provider.workspace_id, '-', ''), 25, 8) || '-' ||
      substr(replace(provider.workspace_id, '-', ''), 1, 4) || '-' ||
      substr(replace(provider.workspace_id, '-', ''), 5, 4) || '-' ||
      substr(replace(provider.workspace_id, '-', ''), 9, 4) || '-' ||
      substr(replace(provider.workspace_id, '-', ''), 13, 12)
  END AS provider_id,
  CASE
    WHEN provider.workspace_id = 'default' THEN 'f2000000-0000-4000-8000-000000000007'
    ELSE
      substr(replace(provider.workspace_id, '-', ''), 17, 8) || '-' ||
      substr(replace(provider.workspace_id, '-', ''), 29, 4) || '-' ||
      substr(replace(provider.workspace_id, '-', ''), 1, 4) || '-' ||
      substr(replace(provider.workspace_id, '-', ''), 5, 4) || '-' ||
      substr(replace(provider.workspace_id, '-', ''), 9, 12)
  END AS model_id
FROM model_providers AS provider
WHERE provider.kind = 'senseaudio_asr'
  AND provider.id = (
    SELECT candidate.id
    FROM model_providers AS candidate
    JOIN model_entries AS entry ON entry.provider_id = candidate.id
    WHERE candidate.workspace_id = provider.workspace_id
      AND candidate.kind = 'senseaudio_asr'
      AND entry.slug = 'senseaudio-asr-pro-1.5-260319'
    ORDER BY candidate.sort_order, candidate.id
    LIMIT 1
  )
  AND NOT EXISTS (
    SELECT 1
    FROM model_providers AS existing
    WHERE existing.workspace_id = provider.workspace_id
      AND existing.kind = 'senseaudio_asr_pro'
  );

INSERT INTO model_providers (
  id,
  workspace_id,
  name,
  kind,
  base_url,
  api_key_ciphertext,
  enabled,
  sort_order
)
SELECT
  source.provider_id,
  source.workspace_id,
  'ASR API 专业语音识别',
  'senseaudio_asr_pro',
  'http://180.184.148.131:30002/api/v2/asr/pro',
  source.api_key_ciphertext,
  source.enabled,
  COALESCE(
    (
      SELECT MAX(existing.sort_order) + 1
      FROM model_providers AS existing
      WHERE existing.workspace_id = source.workspace_id
    ),
    0
  )
FROM r0061_pro_asr_sources AS source;

INSERT INTO model_entries (
  id,
  workspace_id,
  provider_id,
  slug,
  label,
  description,
  capabilities,
  categories,
  enabled,
  sort_order
)
SELECT
  source.model_id,
  source.workspace_id,
  source.provider_id,
  'pro-asr',
  '专业语音识别',
  '支持说话人分段、句级时间戳与保真文本整理的专业语音识别模型',
  '["speech_recognition"]',
  '["speech_recognition"]',
  TRUE,
  0
FROM r0061_pro_asr_sources AS source
WHERE EXISTS (
  SELECT 1 FROM model_providers AS provider WHERE provider.id = source.provider_id
);

UPDATE model_catalog_state
SET revision = revision + 1,
    updated_at = CURRENT_TIMESTAMP
WHERE id IN (
  SELECT workspace_id FROM r0061_pro_asr_sources
  UNION
  SELECT workspace_id FROM model_providers WHERE kind = 'senseaudio_asr_pro'
);

DROP TABLE r0061_pro_asr_sources;
"""
