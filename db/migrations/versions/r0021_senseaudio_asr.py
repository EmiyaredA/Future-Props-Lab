MIGRATION_ID = "r0021_senseaudio_asr"

SQL = r"""
PRAGMA legacy_alter_table = ON;

ALTER TABLE model_providers RENAME TO model_providers_r0021_old;
CREATE TABLE model_providers (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  kind VARCHAR(24) NOT NULL CHECK (
    kind IN (
      'openai',
      'anthropic',
      'senseaudio_image',
      'senseaudio_video',
      'senseaudio_asr'
    )
  ),
  base_url VARCHAR(512) NOT NULL DEFAULT '',
  api_key_ciphertext TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  workspace_id VARCHAR(36) NOT NULL DEFAULT 'default'
);
INSERT INTO model_providers (
  id,
  name,
  kind,
  base_url,
  api_key_ciphertext,
  enabled,
  sort_order,
  created_at,
  updated_at,
  workspace_id
)
SELECT
  id,
  name,
  kind,
  base_url,
  api_key_ciphertext,
  enabled,
  sort_order,
  created_at,
  updated_at,
  workspace_id
FROM model_providers_r0021_old;
DROP TABLE model_providers_r0021_old;
CREATE INDEX ix_model_providers_workspace
  ON model_providers(workspace_id, sort_order);

PRAGMA legacy_alter_table = OFF;

ALTER TABLE galgame_asset_metadata
ADD COLUMN transcript_segments JSON NOT NULL DEFAULT '[]';

ALTER TABLE galgame_asset_transcription_tasks
ADD COLUMN result_segments JSON NOT NULL DEFAULT '[]';

CREATE TEMP TABLE r0021_asr_workspaces AS
SELECT state.id AS workspace_id
FROM model_catalog_state AS state
WHERE NOT EXISTS (
  SELECT 1
  FROM model_providers AS provider
  WHERE provider.workspace_id = state.id
    AND provider.kind = 'senseaudio_asr'
);

WITH workspace_provider(workspace_id, provider_id) AS (
  SELECT
    workspace_id,
    CASE
      WHEN workspace_id = 'default' THEN 'f0000000-0000-4000-8000-000000000005'
      ELSE
        substr(replace(workspace_id, '-', ''), 9, 8) || '-' ||
        substr(replace(workspace_id, '-', ''), 17, 4) || '-' ||
        substr(replace(workspace_id, '-', ''), 21, 4) || '-' ||
        substr(replace(workspace_id, '-', ''), 25, 4) || '-' ||
        substr(replace(workspace_id, '-', ''), 29, 4) ||
        substr(replace(workspace_id, '-', ''), 1, 8)
    END
  FROM r0021_asr_workspaces
)
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
  workspace_provider.provider_id,
  workspace_provider.workspace_id,
  'SenseAudio 专业说话人识别',
  'senseaudio_asr',
  'https://api.senseaudio.cn/v1',
  '',
  FALSE,
  COALESCE(
    (
      SELECT MAX(existing.sort_order) + 1
      FROM model_providers AS existing
      WHERE existing.workspace_id = workspace_provider.workspace_id
    ),
    0
  )
FROM workspace_provider;

WITH workspace_model(workspace_id, model_id) AS (
  SELECT
    workspace_id,
    CASE
      WHEN workspace_id = 'default' THEN 'f2000000-0000-4000-8000-000000000006'
      ELSE
        substr(replace(workspace_id, '-', ''), 17, 8) || '-' ||
        substr(replace(workspace_id, '-', ''), 25, 4) || '-' ||
        substr(replace(workspace_id, '-', ''), 29, 4) || '-' ||
        substr(replace(workspace_id, '-', ''), 1, 4) || '-' ||
        substr(replace(workspace_id, '-', ''), 5, 12)
    END
  FROM r0021_asr_workspaces
)
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
  workspace_model.model_id,
  workspace_model.workspace_id,
  provider.id,
  'senseaudio-asr-pro-1.5-260319',
  'SenseAudio ASR Pro 1.5',
  '支持说话人分离与句级时间戳的专业语音识别模型',
  '["speech_recognition"]',
  '["speech_recognition"]',
  TRUE,
  0
FROM workspace_model
JOIN model_providers AS provider
  ON provider.workspace_id = workspace_model.workspace_id
 AND provider.kind = 'senseaudio_asr';

UPDATE model_catalog_state
SET revision = revision + 1,
    updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT workspace_id FROM r0021_asr_workspaces);

DROP TABLE r0021_asr_workspaces;
"""
