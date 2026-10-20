"""Allow complete Skill descriptions while preserving immutable version records."""

MIGRATION_ID = "0102_skill_description"
SQL = """
CREATE TABLE integration_skills_new (
  id VARCHAR(36) PRIMARY KEY,
  workspace_id VARCHAR(36) NOT NULL DEFAULT 'default' REFERENCES workspaces(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(4000) NOT NULL DEFAULT '',
  default_version VARCHAR(24) NOT NULL DEFAULT 'v1',
  latest_version VARCHAR(24) NOT NULL DEFAULT 'v1',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(16) NOT NULL DEFAULT 'healthy'
    CHECK (status IN ('unchecked', 'healthy', 'failed')),
  status_message VARCHAR(500) NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  tags JSON NOT NULL DEFAULT '[]',
  UNIQUE (workspace_id, name)
);
INSERT INTO integration_skills_new (
  id, workspace_id, name, description, default_version, latest_version,
  enabled, status, status_message, revision, created_at, updated_at, tags
)
SELECT id, workspace_id, name, description, default_version, latest_version,
  enabled, status, status_message, revision, created_at, updated_at, tags
FROM integration_skills;

CREATE TABLE integration_skill_versions_new (
  id VARCHAR(36) PRIMARY KEY,
  skill_id VARCHAR(36) NOT NULL REFERENCES integration_skills(id) ON DELETE CASCADE,
  version VARCHAR(24) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(4000) NOT NULL DEFAULT '',
  storage_path VARCHAR(1024) NOT NULL,
  content_sha256 VARCHAR(64) NOT NULL,
  file_count INTEGER NOT NULL CHECK (file_count >= 1),
  expanded_bytes INTEGER NOT NULL CHECK (expanded_bytes >= 1),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (skill_id, version)
);
INSERT INTO integration_skill_versions_new (
  id, skill_id, version, name, description, storage_path,
  content_sha256, file_count, expanded_bytes, created_at
)
SELECT id, skill_id, version, name, description, storage_path,
  content_sha256, file_count, expanded_bytes, created_at
FROM integration_skill_versions;

DROP TABLE integration_skill_versions;
DROP TABLE integration_skills;
ALTER TABLE integration_skills_new RENAME TO integration_skills;
ALTER TABLE integration_skill_versions_new RENAME TO integration_skill_versions;
CREATE INDEX ix_integration_skills_workspace ON integration_skills(workspace_id, updated_at);
CREATE INDEX ix_integration_skill_versions_skill
  ON integration_skill_versions(skill_id, created_at);
"""
