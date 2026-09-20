MIGRATION_ID = "r0068_senseaudio_catalog_sync"

SQL = r"""
WITH incoming_models(
  id,
  provider_id,
  append_order,
  slug,
  label,
  description,
  capabilities,
  categories
) AS (
  VALUES
    (
      'f1000000-0000-4000-8000-000000000018',
      'f0000000-0000-4000-8000-000000000001',
      1,
      'sensenova-6.8-flash-lite',
      'SenseNova 6.8 Flash-Lite',
      '面向真实工作流的轻量多模态智能体模型',
      '["chat","vision","tools"]',
      '["text_generation"]'
    ),
    (
      'f1000000-0000-4000-8000-000000000019',
      'f0000000-0000-4000-8000-000000000001',
      2,
      'deepseek-v4.1-flash',
      'DeepSeek V4.1 Flash',
      '高速高性价比文本生成与工具调用模型',
      '["chat","tools"]',
      '["text_generation"]'
    ),
    (
      'f1000000-0000-4000-8000-000000000020',
      'f0000000-0000-4000-8000-000000000001',
      3,
      'deepseek-v4-flash-0731',
      'DeepSeek V4 Flash 0731',
      '百万上下文高速文本生成与工具调用模型',
      '["chat","tools"]',
      '["text_generation"]'
    ),
    (
      'f1000000-0000-4000-8000-000000000021',
      'f0000000-0000-4000-8000-000000000001',
      4,
      'qwen3.8-27b',
      'Qwen3.8 27B',
      '通用文本生成与工具调用模型',
      '["chat","tools"]',
      '["text_generation"]'
    ),
    (
      'f1000000-0000-4000-8000-000000000022',
      'f0000000-0000-4000-8000-000000000001',
      5,
      'glm-5.3-flash',
      'GLM-5.3 Flash',
      '百万上下文高速文本生成模型',
      '["chat","tools"]',
      '["text_generation"]'
    ),
    (
      'f2000000-0000-4000-8000-000000000011',
      'f0000000-0000-4000-8000-000000000008',
      1,
      'senseaudio-music-1.0-260319',
      'SenseAudio Music 1.0',
      '面向歌词与歌曲生成的异步音乐创作模型',
      '["audio_generation"]',
      '["music_generation"]'
    )
)
INSERT OR IGNORE INTO model_entries (
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
  incoming_models.id,
  provider.workspace_id,
  provider.id,
  incoming_models.slug,
  incoming_models.label,
  incoming_models.description,
  incoming_models.capabilities,
  incoming_models.categories,
  TRUE,
  COALESCE(
    (
      SELECT MAX(existing.sort_order)
      FROM model_entries AS existing
      WHERE existing.provider_id = provider.id
    ),
    -1
  ) + incoming_models.append_order
FROM incoming_models
JOIN model_providers AS provider
  ON provider.id = incoming_models.provider_id
WHERE NOT EXISTS (
  SELECT 1
  FROM model_entries AS existing
  WHERE existing.provider_id = provider.id
    AND existing.slug = incoming_models.slug
);

UPDATE model_catalog_state
SET revision = revision + 1,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'default'
  AND changes() > 0;
"""
