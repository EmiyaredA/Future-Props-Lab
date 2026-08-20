MIGRATION_ID = "r0025_pro_asr_provider"

SQL = r"""
CREATE TEMP TABLE r0025_pro_asr_sources AS
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
      AND existing.kind = 'senseaudio_asr'
      AND existing.base_url = 'http://180.184.148.131:30002/api/v2/asr/pro'
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
  'senseaudio_asr',
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
FROM r0025_pro_asr_sources AS source;

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
FROM r0025_pro_asr_sources AS source;

UPDATE model_catalog_state
SET revision = revision + 1,
    updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT workspace_id FROM r0025_pro_asr_sources);

DROP TABLE r0025_pro_asr_sources;
"""
