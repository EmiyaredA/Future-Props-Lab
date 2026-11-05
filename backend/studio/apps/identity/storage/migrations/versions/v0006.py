"""Idempotent audit acknowledgements for source-owned project certification."""

SQL = """
CREATE TABLE identity_certification_audit_receipts (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    fingerprint VARCHAR(64) NOT NULL,
    audit_event_id VARCHAR(36) NOT NULL UNIQUE,
    created_at DATETIME NOT NULL
);
"""
