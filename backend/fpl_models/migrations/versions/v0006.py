"""Accepted model jobs retain the signed request that authorized their immutable input."""

SQL = """CREATE TABLE model_task_authorizations (
    kind VARCHAR(24) NOT NULL CHECK(kind IN ('inference', 'model', 'transcription')),
    task_id VARCHAR(36) NOT NULL,
    owner_user_id VARCHAR(36) NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    source_method VARCHAR(12) NOT NULL,
    source_path VARCHAR(4096) NOT NULL,
    assertion VARCHAR(8192) NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY(kind, task_id)
);
CREATE INDEX ix_model_task_authorizations_owner_user_id
    ON model_task_authorizations(owner_user_id);
"""
