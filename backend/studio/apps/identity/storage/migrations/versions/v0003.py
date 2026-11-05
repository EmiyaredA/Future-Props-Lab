"""Private Models audit delivery retains immutable receipt digests."""

SQL = """CREATE TABLE identity_model_audit_receipts (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    fingerprint VARCHAR(64) NOT NULL,
    audit_event_id VARCHAR(36) NOT NULL UNIQUE,
    created_at DATETIME NOT NULL
);
"""
