"""Bind each interview preparation to one native execution and receipt."""

SQL = """
CREATE TABLE interview_native_leases (
    task_id VARCHAR(36) NOT NULL PRIMARY KEY
        REFERENCES interview_preparations(id) ON DELETE CASCADE,
    owner_user_id VARCHAR(36) NOT NULL,
    worker_id VARCHAR(100) NOT NULL,
    lease_id VARCHAR(36) NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    outcome_sha256 VARCHAR(64)
);
CREATE INDEX ix_interview_native_leases_expiry
    ON interview_native_leases (expires_at);
"""
