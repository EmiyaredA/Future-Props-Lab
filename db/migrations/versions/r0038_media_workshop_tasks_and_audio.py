# ruff: noqa: E501

MIGRATION_ID = "r0038_media_workshop_tasks_and_audio"

SQL = r"""
PRAGMA legacy_alter_table = ON;

ALTER TABLE video_editor_tasks RENAME TO video_editor_tasks_r0038_old;
CREATE TABLE video_editor_tasks (
  id VARCHAR(36) PRIMARY KEY,
  workspace_id VARCHAR(36) NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id VARCHAR(36) NOT NULL REFERENCES video_editor_projects(id) ON DELETE CASCADE,
  request_id VARCHAR(64) NOT NULL,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('media', 'render', 'segment_export')),
  status VARCHAR(16) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  request_payload JSON NOT NULL DEFAULT '{}',
  snapshot_document JSON NOT NULL DEFAULT '{}',
  result_detail JSON NOT NULL DEFAULT '{}',
  output_asset_id VARCHAR(36) REFERENCES visual_assets(id) ON DELETE SET NULL,
  error TEXT,
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  UNIQUE(project_id, request_id)
);
INSERT INTO video_editor_tasks SELECT * FROM video_editor_tasks_r0038_old;
DROP TABLE video_editor_tasks_r0038_old;
CREATE INDEX ix_video_editor_tasks_status_created ON video_editor_tasks(status, created_at);
CREATE INDEX ix_video_editor_tasks_project_created ON video_editor_tasks(project_id, created_at);

ALTER TABLE visual_generation_tasks RENAME TO visual_generation_tasks_r0038_old;
CREATE TABLE visual_generation_tasks (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL REFERENCES visual_workshop_projects(id) ON DELETE CASCADE,
  provider_id VARCHAR(36) REFERENCES model_providers(id) ON DELETE SET NULL,
  model_id VARCHAR(36) REFERENCES model_entries(id) ON DELETE SET NULL,
  provider_kind VARCHAR(24) NOT NULL CHECK (
    provider_kind IN ('senseaudio_image', 'senseaudio_video', 'senseaudio_music', 'senseaudio_sfx')
  ),
  generation_kind VARCHAR(16) NOT NULL CHECK (generation_kind IN ('image', 'video', 'audio')),
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
  result_asset_id VARCHAR(36) REFERENCES visual_assets(id) ON DELETE SET NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  workspace_id VARCHAR(36) NOT NULL DEFAULT 'default'
);
INSERT INTO visual_generation_tasks SELECT * FROM visual_generation_tasks_r0038_old;
DROP TABLE visual_generation_tasks_r0038_old;
CREATE INDEX ix_visual_generation_tasks_project_created
  ON visual_generation_tasks(project_id, created_at DESC);
CREATE INDEX ix_visual_generation_tasks_status_updated
  ON visual_generation_tasks(status, updated_at);
CREATE INDEX ix_visual_generation_tasks_provider
  ON visual_generation_tasks(provider_id, status);

ALTER TABLE model_providers RENAME TO model_providers_r0038_old;
CREATE TABLE model_providers (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  kind VARCHAR(24) NOT NULL CHECK (
    kind IN (
      'openai', 'anthropic', 'senseaudio_image', 'senseaudio_video',
      'senseaudio_asr', 'senseaudio_realtime', 'senseaudio_music', 'senseaudio_sfx'
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
INSERT INTO model_providers SELECT * FROM model_providers_r0038_old;
DROP TABLE model_providers_r0038_old;
CREATE INDEX ix_model_providers_workspace ON model_providers(workspace_id, sort_order);

PRAGMA legacy_alter_table = OFF;

CREATE TEMP TABLE r0038_audio_workspaces AS
SELECT
  state.id AS workspace_id,
  CASE WHEN state.id = 'default'
    THEN 'f0000000-0000-4000-8000-000000000008'
    ELSE 'r38mu-' || substr(replace(state.id, '-', ''), 1, 30) END AS music_provider_id,
  CASE WHEN state.id = 'default'
    THEN 'f0000000-0000-4000-8000-000000000009'
    ELSE 'r38sf-' || substr(replace(state.id, '-', ''), 1, 30) END AS sfx_provider_id,
  CASE WHEN state.id = 'default'
    THEN 'f2000000-0000-4000-8000-000000000009'
    ELSE 'r38mm-' || substr(replace(state.id, '-', ''), 1, 30) END AS music_model_id,
  CASE WHEN state.id = 'default'
    THEN 'f2000000-0000-4000-8000-000000000010'
    ELSE 'r38sm-' || substr(replace(state.id, '-', ''), 1, 30) END AS sfx_model_id
FROM model_catalog_state AS state
WHERE EXISTS (
  SELECT 1 FROM model_providers p WHERE p.workspace_id = state.id
);

INSERT INTO model_providers (
  id, workspace_id, name, kind, base_url, api_key_ciphertext, enabled, sort_order
)
SELECT music_provider_id, workspace_id, 'SenseAudio 音乐生成', 'senseaudio_music',
  'https://api.senseaudio.cn/v1', '', FALSE,
  COALESCE((SELECT MAX(sort_order) + 1 FROM model_providers p WHERE p.workspace_id = source.workspace_id), 0)
FROM r0038_audio_workspaces source
WHERE NOT EXISTS (
  SELECT 1 FROM model_providers p
  WHERE p.workspace_id = source.workspace_id AND p.kind = 'senseaudio_music'
);

INSERT INTO model_providers (
  id, workspace_id, name, kind, base_url, api_key_ciphertext, enabled, sort_order
)
SELECT sfx_provider_id, workspace_id, 'SenseAudio 音效生成', 'senseaudio_sfx',
  'https://api.senseaudio.cn/v1', '', FALSE,
  COALESCE((SELECT MAX(sort_order) + 1 FROM model_providers p WHERE p.workspace_id = source.workspace_id), 0)
FROM r0038_audio_workspaces source
WHERE NOT EXISTS (
  SELECT 1 FROM model_providers p
  WHERE p.workspace_id = source.workspace_id AND p.kind = 'senseaudio_sfx'
);

INSERT INTO model_entries (
  id, workspace_id, provider_id, slug, label, description,
  capabilities, categories, enabled, sort_order
)
SELECT music_model_id, workspace_id, music_provider_id,
  'senseaudio-music-2.0-260626', 'SenseAudio Music 2.0',
  '面向纯音乐与背景音乐创作的异步生成模型',
  '["audio_generation"]', '["music_generation"]', TRUE, 0
FROM r0038_audio_workspaces source
WHERE EXISTS (SELECT 1 FROM model_providers p WHERE p.id = source.music_provider_id)
  AND NOT EXISTS (
    SELECT 1 FROM model_entries m
    WHERE m.workspace_id = source.workspace_id
      AND m.provider_id = source.music_provider_id
      AND m.slug = 'senseaudio-music-2.0-260626'
  );

INSERT INTO model_entries (
  id, workspace_id, provider_id, slug, label, description,
  capabilities, categories, enabled, sort_order
)
SELECT sfx_model_id, workspace_id, sfx_provider_id,
  'senseaudio-sfx-1.0-260626', 'SenseAudio SFX 1.0',
  '根据描述同步生成短音效的模型',
  '["audio_generation"]', '["music_generation"]', TRUE, 0
FROM r0038_audio_workspaces source
WHERE EXISTS (SELECT 1 FROM model_providers p WHERE p.id = source.sfx_provider_id)
  AND NOT EXISTS (
    SELECT 1 FROM model_entries m
    WHERE m.workspace_id = source.workspace_id
      AND m.provider_id = source.sfx_provider_id
      AND m.slug = 'senseaudio-sfx-1.0-260626'
  );

UPDATE model_catalog_state
SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT workspace_id FROM r0038_audio_workspaces);

DROP TABLE r0038_audio_workspaces;
"""
