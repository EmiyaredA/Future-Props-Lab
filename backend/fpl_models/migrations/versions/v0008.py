"""Native commands keep proof and immutable delivery state in Models-owned storage."""

SQL = """
CREATE TABLE model_native_jobs (
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
    output_descriptor JSON,
    applied_at DATETIME,
    revision INTEGER NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE(owner_user_id, request_id)
);
CREATE INDEX ix_model_native_jobs_owner_user_id ON model_native_jobs(owner_user_id);
CREATE INDEX ix_model_native_jobs_status ON model_native_jobs(status);
CREATE TABLE model_native_proofs (
    job_id VARCHAR(36) NOT NULL PRIMARY KEY REFERENCES model_native_jobs(id),
    owner_user_id VARCHAR(36) NOT NULL,
    source_method VARCHAR(12) NOT NULL,
    source_path VARCHAR(4096) NOT NULL,
    assertion VARCHAR(8192) NOT NULL,
    source_fingerprint VARCHAR(64),
    accepted_at DATETIME
);
CREATE INDEX ix_model_native_proofs_owner_user_id ON model_native_proofs(owner_user_id);
CREATE TABLE model_native_observations (
    id VARCHAR(100) NOT NULL PRIMARY KEY,
    payload JSON NOT NULL,
    observed_at DATETIME NOT NULL
);
"""
