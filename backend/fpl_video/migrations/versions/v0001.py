"""Video Editor owns project and timeline records."""

SQL = """
CREATE TABLE video_editor_projects (
    id VARCHAR(36) PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    title VARCHAR(120) NOT NULL,
    status VARCHAR(16) NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    source_application VARCHAR(32),
    source_project_id VARCHAR(36),
    source_revision INTEGER,
    source_compiler_version VARCHAR(64),
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);
CREATE INDEX ix_video_editor_projects_account_updated
  ON video_editor_projects (owner_user_id, updated_at);
CREATE TABLE video_editor_timelines (
    project_id VARCHAR(36) PRIMARY KEY REFERENCES video_editor_projects(id) ON DELETE CASCADE,
    document JSON NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    updated_at DATETIME NOT NULL
);
"""
