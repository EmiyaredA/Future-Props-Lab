"""Keep workbench directory bindings in the Agents database."""

SQL = """
CREATE TABLE workbench_projects (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    root TEXT NOT NULL,
    last_used_at INTEGER NOT NULL,
    UNIQUE (owner_user_id, root)
);
CREATE INDEX ix_workbench_projects_recent
    ON workbench_projects(owner_user_id, last_used_at DESC, id);
"""
