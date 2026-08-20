MIGRATION_ID = "r0022_audio_annotation"

SQL = r"""
CREATE TABLE audio_annotation_projects (
  id VARCHAR(36) PRIMARY KEY,
  workspace_id VARCHAR(36) NOT NULL DEFAULT 'default'
    REFERENCES workspaces(id) ON DELETE CASCADE,
  asset_id VARCHAR(36) NOT NULL REFERENCES visual_assets(id) ON DELETE RESTRICT,
  title VARCHAR(120) NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  duration_ms INTEGER NOT NULL CHECK (duration_ms > 0 AND duration_ms <= 3600000),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_audio_annotation_projects_workspace_updated
  ON audio_annotation_projects(workspace_id, updated_at DESC, created_at DESC);
CREATE INDEX ix_audio_annotation_projects_asset
  ON audio_annotation_projects(asset_id);

CREATE TABLE audio_annotation_documents (
  project_id VARCHAR(36) PRIMARY KEY
    REFERENCES audio_annotation_projects(id) ON DELETE CASCADE,
  schema_version VARCHAR(16) NOT NULL DEFAULT '1.0' CHECK (schema_version = '1.0'),
  speakers JSON NOT NULL DEFAULT '[]',
  segments JSON NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audio_annotation_waveforms (
  project_id VARCHAR(36) PRIMARY KEY
    REFERENCES audio_annotation_projects(id) ON DELETE CASCADE,
  duration_ms INTEGER NOT NULL CHECK (duration_ms > 0 AND duration_ms <= 3600000),
  peaks JSON NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""
