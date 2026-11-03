"""Integration intents retain fixed scope and non-secret actor references, never JWT proof."""

SQL = """CREATE TABLE identity_integration_intents (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    caller VARCHAR(32) NOT NULL,
    request_id VARCHAR(36) NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    source_method VARCHAR(12) NOT NULL,
    source_path VARCHAR(4096) NOT NULL,
    actor JSON NOT NULL,
    scope JSON NOT NULL,
    created_at DATETIME NOT NULL,
    UNIQUE(caller,request_id)
);
"""
