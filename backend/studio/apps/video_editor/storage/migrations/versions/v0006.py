"""Persist frozen render payloads and remote settlement through project deletion."""

SQL = """
CREATE TABLE video_render_dispatches (
    task_id VARCHAR(36) PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL,
    frozen JSON NOT NULL,
    settled BOOLEAN NOT NULL,
    checked_at DATETIME NOT NULL
);
CREATE INDEX ix_video_render_dispatch_checked ON video_render_dispatches(checked_at);
"""
