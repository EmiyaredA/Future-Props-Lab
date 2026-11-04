"""Store the annotation-owned project, document, waveform and operation receipts."""

SQL = """
CREATE TABLE audio_annotation_projects (
  id VARCHAR(36) PRIMARY KEY,
  owner_user_id VARCHAR(36) NOT NULL,
  asset_id VARCHAR(36) NOT NULL,
  title VARCHAR(120) NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  duration_ms INTEGER NOT NULL CHECK (duration_ms > 0 AND duration_ms <= 3600000),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_audio_annotation_projects_account_updated
  ON audio_annotation_projects(owner_user_id, updated_at DESC, created_at DESC);
CREATE INDEX ix_audio_annotation_projects_asset
  ON audio_annotation_projects(asset_id);

CREATE TABLE audio_annotation_documents (
  project_id VARCHAR(36) PRIMARY KEY
    REFERENCES audio_annotation_projects(id) ON DELETE CASCADE,
  schema_version VARCHAR(16) NOT NULL DEFAULT '1.0' CHECK (schema_version = '1.0'),
  speakers JSON NOT NULL DEFAULT '[]',
  custom_emotions JSON NOT NULL DEFAULT '[]',
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

CREATE TABLE annotation_reference_mutations (
    owner_user_id VARCHAR(36) NOT NULL,
    request_id VARCHAR(128) NOT NULL,
    change_sha256 VARCHAR(64) NOT NULL,
    change JSON NOT NULL,
    authority TEXT NOT NULL,
    state VARCHAR(16) NOT NULL,
    asset_intent_id VARCHAR(128),
    resource_revision INTEGER,
    deleted BOOLEAN NOT NULL,
    delivered_result JSON,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (owner_user_id, request_id)
);
CREATE INDEX ix_annotation_reference_mutations_state
    ON annotation_reference_mutations (state);

CREATE TABLE project_operation_receipts (
    owner_user_id VARCHAR(36) NOT NULL,
    resource_kind VARCHAR(40) NOT NULL,
    resource_id VARCHAR(64) NOT NULL,
    request_id VARCHAR(64) NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    result JSON NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (owner_user_id, resource_kind, resource_id, request_id)
);
"""
