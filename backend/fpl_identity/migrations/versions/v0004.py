"""Audit intents store inert event data and source digests, never request credentials."""

SQL = """CREATE TABLE identity_model_audit_intents (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    fingerprint VARCHAR(64) NOT NULL,
    payload JSON NOT NULL,
    parent_id VARCHAR(36),
    created_at DATETIME NOT NULL
);
CREATE INDEX ix_identity_model_audit_intents_parent_id
    ON identity_model_audit_intents(parent_id);
"""
