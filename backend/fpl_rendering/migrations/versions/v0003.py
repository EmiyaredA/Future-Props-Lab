"""Persist independent Video media processing jobs and derivative receipts."""

SQL = """
CREATE TABLE video_media_jobs (
    owner_user_id VARCHAR(128) NOT NULL,
    id VARCHAR(128) NOT NULL,
    project_id VARCHAR(128) NOT NULL,
    asset_id VARCHAR(128) NOT NULL,
    status VARCHAR(16) NOT NULL,
    probe JSON NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    outputs JSON NOT NULL,
    error TEXT,
    cancel_requested BOOLEAN NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (owner_user_id, id)
);
CREATE INDEX ix_video_media_jobs_status_created ON video_media_jobs(status, created_at);
"""
