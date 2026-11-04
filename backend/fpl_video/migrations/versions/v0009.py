"""Keep the source decision while Visual or Assets may be recovering."""

SQL = """
CREATE TABLE video_segment_deliveries (
    task_id VARCHAR(36) PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL,
    scope_sha256 VARCHAR(64) NOT NULL,
    state VARCHAR(16) NOT NULL CHECK(state IN ('preparing','commit','abort','published','aborted')),
    error TEXT
);
CREATE INDEX ix_video_segment_deliveries_project
    ON video_segment_deliveries (owner_user_id, project_id, state);
"""
