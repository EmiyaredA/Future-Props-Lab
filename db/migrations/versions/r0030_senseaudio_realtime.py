MIGRATION_ID = "r0030_senseaudio_realtime"

SQL = r"""
PRAGMA legacy_alter_table = ON;

ALTER TABLE model_providers RENAME TO model_providers_r0030_old;
CREATE TABLE model_providers (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  kind VARCHAR(24) NOT NULL CHECK (
    kind IN (
      'openai',
      'anthropic',
      'senseaudio_image',
      'senseaudio_video',
      'senseaudio_asr',
      'senseaudio_realtime'
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
  id, name, kind, base_url, api_key_ciphertext, enabled, sort_order,
  created_at, updated_at, workspace_id
)
SELECT
  id, name, kind, base_url, api_key_ciphertext, enabled, sort_order,
  created_at, updated_at, workspace_id
FROM model_providers_r0030_old;
DROP TABLE model_providers_r0030_old;
CREATE INDEX ix_model_providers_workspace
  ON model_providers(workspace_id, sort_order);

PRAGMA legacy_alter_table = OFF;

CREATE TEMP TABLE r0030_realtime_workspaces AS
SELECT
  state.id AS workspace_id,
  CASE
    WHEN state.id = 'default' THEN 'f0000000-0000-4000-8000-000000000007'
    ELSE 'r0030-' || substr(replace(state.id, '-', ''), 1, 30)
  END AS provider_id,
  CASE
    WHEN state.id = 'default' THEN 'f2000000-0000-4000-8000-000000000008'
    ELSE 'r30m-' || substr(replace(state.id, '-', ''), 1, 31)
  END AS model_id,
  COALESCE((
    SELECT source.api_key_ciphertext
    FROM model_providers AS source
    WHERE source.workspace_id = state.id
      AND source.base_url = 'https://api.senseaudio.cn/v1'
      AND source.enabled = TRUE
      AND source.api_key_ciphertext <> ''
    ORDER BY source.sort_order, source.id
    LIMIT 1
  ), '') AS api_key_ciphertext
FROM model_catalog_state AS state
WHERE NOT EXISTS (
  SELECT 1
  FROM model_providers AS existing
  WHERE existing.workspace_id = state.id
    AND existing.kind = 'senseaudio_realtime'
);

INSERT INTO model_providers (
  id, workspace_id, name, kind, base_url, api_key_ciphertext, enabled, sort_order
)
SELECT
  source.provider_id,
  source.workspace_id,
  'SenseAudio 实时语音',
  'senseaudio_realtime',
  'wss://api.senseaudio.cn/ws/v1/realtime/voice-dialog',
  source.api_key_ciphertext,
  CASE WHEN source.api_key_ciphertext <> '' THEN TRUE ELSE FALSE END,
  COALESCE((
    SELECT MAX(existing.sort_order) + 1
    FROM model_providers AS existing
    WHERE existing.workspace_id = source.workspace_id
  ), 0)
FROM r0030_realtime_workspaces AS source;

INSERT INTO model_entries (
  id, workspace_id, provider_id, slug, label, description,
  capabilities, categories, enabled, sort_order
)
SELECT
  source.model_id,
  source.workspace_id,
  source.provider_id,
  'senseaudio-realtime-1.0',
  'SenseAudio Realtime 1.0',
  '支持免按键双工、实时转写与语音打断的端到端语音模型',
  '["voice"]',
  '["end_to_end_speech"]',
  TRUE,
  0
FROM r0030_realtime_workspaces AS source;

UPDATE model_catalog_state
SET revision = revision + 1,
    updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT workspace_id FROM r0030_realtime_workspaces);

DROP TABLE r0030_realtime_workspaces;
"""
