"""Durable Rendering jobs and sealed output receipts for Galgame."""

SQL = """
CREATE TABLE galgame_export_jobs (
    owner_user_id VARCHAR(36) NOT NULL,
    id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL,
    request_path VARCHAR(512) NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    assertion TEXT NOT NULL,
    input_assertion TEXT NOT NULL,
    payload JSON NOT NULL,
    status VARCHAR(16) NOT NULL,
    phase VARCHAR(16) NOT NULL,
    progress INTEGER NOT NULL,
    rendered_ms INTEGER NOT NULL,
    media JSON,
    error TEXT,
    cancel_requested BOOLEAN NOT NULL,
    released BOOLEAN NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY(owner_user_id, id)
);
CREATE INDEX ix_galgame_export_jobs_pending ON galgame_export_jobs(status, created_at);
"""
