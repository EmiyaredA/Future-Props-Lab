MIGRATION_ID = "r0004_expand_senseaudio_text_catalog"

SQL = r"""
WITH incoming_models(
  id,
  append_order,
  slug,
  label,
  description,
  capabilities
) AS (
  VALUES
    (
      'f1000000-0000-4000-8000-000000000005',
      1,
      'senseaudio-s2',
      'SenseAudio S2',
      '百万上下文旗舰文本生成与工具调用模型',
      '["chat","tools"]'
    ),
    (
      'f1000000-0000-4000-8000-000000000006',
      2,
      'senseaudio-s2-flash',
      'SenseAudio S2 Flash',
      '高速低成本文本生成与工具调用模型',
      '["chat","tools"]'
    ),
    (
      'f1000000-0000-4000-8000-000000000007',
      3,
      'senseaudio-s1',
      'SenseAudio S1',
      '百万上下文文本生成与工具调用模型',
      '["chat","tools"]'
    ),
    (
      'f1000000-0000-4000-8000-000000000008',
      4,
      'senseaudio-vl-lite-1.0-260319',
      'SenseAudio VL Lite 1.0',
      '轻量低成本视觉理解与工具调用模型',
      '["chat","vision","tools"]'
    ),
    (
      'f1000000-0000-4000-8000-000000000009',
      5,
      'sensenova-6.7-flash-lite',
      'SenseNova 6.7 Flash-Lite',
      '面向真实工作流的轻量多模态智能体模型',
      '["chat","vision","tools"]'
    ),
    (
      'f1000000-0000-4000-8000-000000000010',
      6,
      'deepseek-v4-flash',
      'DeepSeek V4 Flash',
      '高速高性价比文本生成与工具调用模型',
      '["chat","tools"]'
    ),
    (
      'f1000000-0000-4000-8000-000000000011',
      7,
      'qwen3.6-27b',
      'Qwen3.6 27B',
      '原生视觉语言 Dense 模型',
      '["chat","vision","tools"]'
    ),
    (
      'f1000000-0000-4000-8000-000000000012',
      8,
      'qwen3.6-35b-a3b',
      'Qwen3.6 35B-A3B',
      '高效 MoE 视觉语言模型',
      '["chat","vision","tools"]'
    ),
    (
      'f1000000-0000-4000-8000-000000000013',
      9,
      'kimi-k2.6',
      'Kimi K2.6',
      '支持图像、视频理解与多步工具调用的多模态模型',
      '["chat","vision","tools"]'
    ),
    (
      'f1000000-0000-4000-8000-000000000014',
      10,
      'glm-5.1',
      'GLM-5.1',
      '面向长程任务与 Coding 的文本生成模型',
      '["chat","tools"]'
    ),
    (
      'f1000000-0000-4000-8000-000000000015',
      11,
      'glm-5.2',
      'GLM-5.2',
      '百万上下文长程任务文本生成模型',
      '["chat","tools"]'
    ),
    (
      'f1000000-0000-4000-8000-000000000016',
      12,
      'minimax-m2.7',
      'MiniMax M2.7',
      '面向编程与 Agent 工作流的文本生成模型',
      '["chat","tools"]'
    ),
    (
      'f1000000-0000-4000-8000-000000000017',
      13,
      'doubao-seed-2-0-pro-260215',
      'Doubao Seed 2.0 Pro',
      '面向复杂推理与长链路任务的多模态通用模型',
      '["chat","vision","tools"]'
    )
)
INSERT OR IGNORE INTO model_entries (
  id,
  provider_id,
  slug,
  label,
  description,
  capabilities,
  enabled,
  sort_order
)
SELECT
  incoming_models.id,
  provider.id,
  incoming_models.slug,
  incoming_models.label,
  incoming_models.description,
  incoming_models.capabilities,
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
  ON provider.id = 'f0000000-0000-4000-8000-000000000001'
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
