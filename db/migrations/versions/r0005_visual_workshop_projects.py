MIGRATION_ID = "r0005_visual_workshop_projects"

SQL = r"""
CREATE TABLE visual_workshop_projects (
  id VARCHAR(36) PRIMARY KEY,
  title VARCHAR(120) NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('image', 'video', 'canvas')),
  status VARCHAR(16) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'completed')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_visual_workshop_projects_updated_at
  ON visual_workshop_projects(updated_at DESC, created_at DESC);
"""
