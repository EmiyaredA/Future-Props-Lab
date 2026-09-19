"""Director desk projects. The document is a placeholder until the editor writes scenes."""

MIGRATION_ID = "r0064_director_desk"

SQL = """
CREATE TABLE director_desk_projects (
 id VARCHAR(36) PRIMARY KEY,
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 title VARCHAR(120) NOT NULL,
 document JSON NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0,
 created_at DATETIME NOT NULL,
 updated_at DATETIME NOT NULL
);
CREATE INDEX ix_director_desk_projects_workspace_updated
 ON director_desk_projects(workspace_id, updated_at);
"""
