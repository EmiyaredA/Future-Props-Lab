MIGRATION_ID = "r0018_galgame_asset_management"

SQL = r"""
CREATE TABLE galgame_asset_metadata (
  asset_id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  category VARCHAR(32) NOT NULL DEFAULT 'other',
  virtual_path VARCHAR(512) NOT NULL,
  packaging_policy VARCHAR(16) NOT NULL DEFAULT 'auto',
  checksum_sha256 VARCHAR(64),
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  transcript TEXT,
  transcript_language VARCHAR(16),
  transcript_status VARCHAR(16) NOT NULL DEFAULT 'pending',
  transcript_source VARCHAR(16),
  transcript_revision INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_id) REFERENCES visual_assets(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES galgame_workshop_projects(id) ON DELETE CASCADE,
  CHECK (packaging_policy IN ('auto', 'include', 'exclude')),
  CHECK (transcript_status IN ('pending', 'queued', 'running', 'ready', 'failed'))
);
CREATE INDEX ix_galgame_asset_metadata_project_path
  ON galgame_asset_metadata(project_id, virtual_path);

CREATE TABLE galgame_asset_settings (
  project_id VARCHAR(36) PRIMARY KEY,
  asr_model_id VARCHAR(36),
  default_language VARCHAR(16) NOT NULL DEFAULT 'auto',
  concurrency INTEGER NOT NULL DEFAULT 2,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES galgame_workshop_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (asr_model_id) REFERENCES model_entries(id) ON DELETE SET NULL,
  CHECK (default_language IN ('auto', 'zh', 'ja')),
  CHECK (concurrency BETWEEN 1 AND 8)
);

CREATE TABLE galgame_asset_transcription_tasks (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  asset_id VARCHAR(36) NOT NULL,
  provider_id VARCHAR(36),
  provider_name VARCHAR(120) NOT NULL DEFAULT '',
  model_id VARCHAR(36),
  model_slug VARCHAR(160) NOT NULL DEFAULT '',
  language VARCHAR(16) NOT NULL DEFAULT 'auto',
  force BOOLEAN NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'queued',
  result_text TEXT,
  error TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES galgame_workshop_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES visual_assets(id) ON DELETE CASCADE,
  CHECK (language IN ('auto', 'zh', 'ja')),
  CHECK (status IN ('queued', 'running', 'completed', 'failed'))
);
CREATE INDEX ix_galgame_asset_transcription_tasks_project_status
  ON galgame_asset_transcription_tasks(project_id, status, created_at);

CREATE TABLE galgame_story_snapshots (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  story_revision INTEGER NOT NULL,
  reason VARCHAR(64) NOT NULL,
  document JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES galgame_workshop_projects(id) ON DELETE CASCADE
);
CREATE INDEX ix_galgame_story_snapshots_project_created
  ON galgame_story_snapshots(project_id, created_at DESC);
"""
