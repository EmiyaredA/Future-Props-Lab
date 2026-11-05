"""Keep the Motion clip import decision and media receipt together."""

SQL = """
CREATE TABLE video_motion_handoffs (
    id VARCHAR(32) PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL REFERENCES video_editor_projects(id) ON DELETE CASCADE,
    source_path VARCHAR(512) NOT NULL,
    payload JSON NOT NULL,
    output_descriptor JSON NOT NULL,
    output_asset_id VARCHAR(36),
    state VARCHAR(16) NOT NULL CHECK(state IN ('pending', 'completed', 'failed')),
    error VARCHAR(128),
    checked_at DATETIME NOT NULL
);
CREATE INDEX ix_video_motion_handoffs_pending ON video_motion_handoffs(state, checked_at);
"""
