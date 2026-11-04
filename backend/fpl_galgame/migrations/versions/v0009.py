"""Freeze the plan and authority until a Galgame video job settles."""

SQL = """
CREATE TABLE galgame_video_dispatches (
    task_id VARCHAR(36) PRIMARY KEY REFERENCES galgame_video_export_tasks(id) ON DELETE CASCADE,
    owner_user_id VARCHAR(36) NOT NULL,
    assertion TEXT NOT NULL,
    plan JSON NOT NULL,
    upload_id VARCHAR(32),
    media JSON,
    checked_at DATETIME NOT NULL
);
CREATE INDEX ix_galgame_video_dispatches_checked_at ON galgame_video_dispatches(checked_at);
ALTER TABLE galgame_upload_intakes ADD COLUMN receipt JSON;
"""
