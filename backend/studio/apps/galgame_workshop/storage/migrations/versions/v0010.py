"""Retain one frozen Galgame-to-Video handoff until both peers have settled."""

SQL = """
CREATE TABLE galgame_handoff_dispatches (
    task_id VARCHAR(36) PRIMARY KEY
        REFERENCES galgame_video_editor_handoffs(id) ON DELETE CASCADE,
    owner_user_id VARCHAR(36) NOT NULL,
    assertion TEXT NOT NULL,
    plan JSON NOT NULL,
    media JSON,
    video_assertion TEXT,
    checked_at DATETIME NOT NULL
);
CREATE INDEX ix_galgame_handoff_dispatches_checked_at ON galgame_handoff_dispatches(checked_at);
"""
