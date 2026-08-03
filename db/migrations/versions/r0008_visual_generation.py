MIGRATION_ID = "r0008_visual_generation"

SQL = r"""
PRAGMA legacy_alter_table = ON;

ALTER TABLE model_providers RENAME TO model_providers_r0008_old;
CREATE TABLE model_providers (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  kind VARCHAR(24) NOT NULL CHECK (
    kind IN ('openai', 'anthropic', 'senseaudio_image', 'senseaudio_video')
  ),
  base_url VARCHAR(512) NOT NULL DEFAULT '',
  api_key_ciphertext TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO model_providers
SELECT * FROM model_providers_r0008_old;
DROP TABLE model_providers_r0008_old;

PRAGMA legacy_alter_table = OFF;

CREATE TABLE visual_generation_tasks (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL
    REFERENCES visual_workshop_projects(id) ON DELETE CASCADE,
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
  result_asset_id VARCHAR(36)
    REFERENCES visual_assets(id) ON DELETE SET NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);
CREATE INDEX ix_visual_generation_tasks_project_created
  ON visual_generation_tasks(project_id, created_at DESC);
CREATE INDEX ix_visual_generation_tasks_status_updated
  ON visual_generation_tasks(status, updated_at);
CREATE INDEX ix_visual_generation_tasks_provider
  ON visual_generation_tasks(provider_id, status);

INSERT OR IGNORE INTO model_providers (
  id, name, kind, base_url, api_key_ciphertext, enabled, sort_order
)
SELECT
  'f0000000-0000-4000-8000-000000000003',
  'SenseAudio 图片生成',
  'senseaudio_image',
  'https://api.senseaudio.cn/v1',
  '',
  FALSE,
  COALESCE((SELECT MAX(sort_order) + 1 FROM model_providers), 0)
WHERE EXISTS (SELECT 1 FROM model_providers LIMIT 1);

INSERT OR IGNORE INTO model_providers (
  id, name, kind, base_url, api_key_ciphertext, enabled, sort_order
)
SELECT
  'f0000000-0000-4000-8000-000000000004',
  'SenseAudio 视频生成',
  'senseaudio_video',
  'https://api.senseaudio.cn/v1',
  '',
  FALSE,
  COALESCE((SELECT MAX(sort_order) + 1 FROM model_providers), 0)
WHERE EXISTS (SELECT 1 FROM model_providers LIMIT 1);

WITH visual_models(id, provider_id, slug, label, description, capabilities, sort_order) AS (
  VALUES
    ('f2000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000003',
     'senseaudio-image-2.0-260319', 'SenseAudio Image 2.0',
     'SenseAudio 高清多比例图片生成模型', '["image_generation"]', 0),
    ('f2000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000003',
     'senseaudio-image-1.0-260319', 'SenseAudio Image 1.0',
     'SenseAudio 通用图片生成模型', '["image_generation"]', 1),
    ('f2000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000003',
     'doubao-seedream-5-0-260128', 'Doubao Seedream 5.0 Lite',
     '高分辨率图片生成模型', '["image_generation"]', 2),
    ('f2000000-0000-4000-8000-000000000004', 'f0000000-0000-4000-8000-000000000003',
     'sensenova-u1-fast', 'SenseNova U1 Fast',
     '面向信息图与高密度版式的图片生成模型', '["image_generation"]', 3),
    ('f2000000-0000-4000-8000-000000000005', 'f0000000-0000-4000-8000-000000000004',
     'doubao-seedance-2-0-260128', 'Doubao Seedance 2.0',
     '支持文本、首尾帧与多模态参考素材的视频生成模型',
     '["video_generation"]', 0)
)
INSERT OR IGNORE INTO model_entries (
  id, provider_id, slug, label, description, capabilities, enabled, sort_order
)
SELECT
  visual_models.id,
  visual_models.provider_id,
  visual_models.slug,
  visual_models.label,
  visual_models.description,
  visual_models.capabilities,
  TRUE,
  visual_models.sort_order
FROM visual_models
JOIN model_providers ON model_providers.id = visual_models.provider_id
WHERE (
  visual_models.provider_id = 'f0000000-0000-4000-8000-000000000003'
  AND model_providers.kind = 'senseaudio_image'
) OR (
  visual_models.provider_id = 'f0000000-0000-4000-8000-000000000004'
  AND model_providers.kind = 'senseaudio_video'
);

UPDATE model_catalog_state
SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP
WHERE id = 'default'
  AND EXISTS (
    SELECT 1 FROM model_providers
    WHERE (id = 'f0000000-0000-4000-8000-000000000003'
           AND kind = 'senseaudio_image')
       OR (id = 'f0000000-0000-4000-8000-000000000004'
           AND kind = 'senseaudio_video')
  );
"""
