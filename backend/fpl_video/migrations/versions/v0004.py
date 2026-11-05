"""Recover an unknown file upload or copy acknowledgement after restart."""

SQL = """
CREATE TABLE video_asset_intakes (
    id VARCHAR(32) PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL REFERENCES video_editor_projects(id) ON DELETE CASCADE,
    target_path VARCHAR(512) NOT NULL,
    assertion TEXT NOT NULL,
    expected_count INTEGER NOT NULL,
    state VARCHAR(16) NOT NULL CHECK(state IN ('pending', 'settled', 'rejected')),
    checked_at DATETIME NOT NULL
);
CREATE INDEX ix_video_asset_intakes_pending ON video_asset_intakes(state, checked_at);
"""
