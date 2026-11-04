"""Own frozen Video movie jobs and sealed output receipts."""

SQL = """
CREATE TABLE video_export_jobs (
    owner_user_id VARCHAR(128) NOT NULL,
    id VARCHAR(36) NOT NULL,
    project_id VARCHAR(128) NOT NULL,
    request_sha256 VARCHAR(64) NOT NULL,
    payload JSON NOT NULL,
    status VARCHAR(16) NOT NULL,
    progress INTEGER NOT NULL,
    probe JSON NOT NULL,
    sealed_output JSON,
    result JSON,
    error TEXT,
    cancel_requested BOOLEAN NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (owner_user_id, id)
);
CREATE INDEX ix_video_export_jobs_queue ON video_export_jobs(status, created_at);
"""
