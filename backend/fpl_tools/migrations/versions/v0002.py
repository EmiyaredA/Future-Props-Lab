"""Store explicit Tools host tasks and immutable execution receipts."""

SQL = """
CREATE TABLE tools_native_jobs (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    request_id VARCHAR(200) NOT NULL,
    operation VARCHAR(100) NOT NULL,
    payload_sha256 VARCHAR(64) NOT NULL,
    payload JSON NOT NULL,
    status VARCHAR(16) NOT NULL,
    worker_id VARCHAR(100) NOT NULL,
    lease_id VARCHAR(36) NOT NULL,
    lease_expires_at DATETIME,
    outcome_sha256 VARCHAR(64),
    result JSON,
    error_code VARCHAR(100) NOT NULL,
    message TEXT NOT NULL,
    revision INTEGER NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE (owner_user_id, request_id)
);
CREATE INDEX ix_tools_native_jobs_owner_user_id ON tools_native_jobs (owner_user_id);
CREATE INDEX ix_tools_native_jobs_status ON tools_native_jobs (status);
"""
