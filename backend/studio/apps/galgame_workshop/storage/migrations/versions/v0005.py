"""Retain Galgame upload reservations until their Assets outcome is known."""

SQL = """
CREATE TABLE galgame_upload_intakes (
    id VARCHAR(32) PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL REFERENCES galgame_workshop_projects(id) ON DELETE CASCADE,
    target_path VARCHAR(512) NOT NULL,
    assertion TEXT NOT NULL,
    category VARCHAR(32) NOT NULL,
    planned JSON NOT NULL,
    manifest JSON NOT NULL,
    state VARCHAR(16) NOT NULL,
    checked_at DATETIME NOT NULL
);
CREATE INDEX ix_galgame_upload_intakes_pending ON galgame_upload_intakes(state, checked_at);
CREATE INDEX ix_galgame_upload_intakes_project
    ON galgame_upload_intakes(owner_user_id, project_id, state);
"""
