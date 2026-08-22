MIGRATION_ID = "r0028_galgame_annotation_imports"

SQL = r"""
CREATE TABLE galgame_annotation_import_tasks (
  id VARCHAR(36) PRIMARY KEY,
  workspace_id VARCHAR(36) NOT NULL DEFAULT 'default'
    REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id VARCHAR(36) NOT NULL
    REFERENCES galgame_workshop_projects(id) ON DELETE CASCADE,
  source_project_id VARCHAR(36) NOT NULL
    REFERENCES audio_annotation_projects(id) ON DELETE RESTRICT,
  request_id VARCHAR(64) NOT NULL,
  expected_source_revision INTEGER NOT NULL CHECK (expected_source_revision >= 0),
  expected_story_revision INTEGER NOT NULL CHECK (expected_story_revision >= 0),
  request_payload JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'conflict', 'rolled_back')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  result_detail JSON NOT NULL DEFAULT '{}',
  error TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  UNIQUE (workspace_id, project_id, request_id)
);
CREATE INDEX ix_galgame_annotation_import_tasks_project_status
  ON galgame_annotation_import_tasks(project_id, status, created_at);
"""
