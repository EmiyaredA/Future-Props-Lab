"""Director desk user motions."""

MIGRATION_ID = "r0065_director_desk_motions"

SQL = """
CREATE TABLE director_desk_user_motions (
 id VARCHAR(36) PRIMARY KEY,
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 motion_key VARCHAR(200) NOT NULL,
 name VARCHAR(100) NOT NULL,
 motion JSON NOT NULL,
 resource JSON NOT NULL,
 created_at DATETIME NOT NULL,
 updated_at DATETIME NOT NULL,
 UNIQUE (workspace_id, motion_key)
);
CREATE INDEX ix_director_desk_user_motions_workspace_name
 ON director_desk_user_motions(workspace_id, name);
"""
