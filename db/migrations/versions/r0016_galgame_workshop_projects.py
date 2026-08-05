MIGRATION_ID = "r0016_galgame_workshop_projects"

SQL = r"""
CREATE TABLE galgame_workshop_projects (
  id VARCHAR(36) PRIMARY KEY,
  title VARCHAR(120) NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  status VARCHAR(16) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'completed')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_galgame_workshop_projects_updated_at
  ON galgame_workshop_projects(updated_at DESC, created_at DESC);

CREATE TABLE galgame_story_documents (
  project_id VARCHAR(36) PRIMARY KEY
    REFERENCES galgame_workshop_projects(id) ON DELETE CASCADE,
  document JSON NOT NULL DEFAULT '{"synopsis":"","chapters":[],"characters":[],"scenes":[]}',
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""
