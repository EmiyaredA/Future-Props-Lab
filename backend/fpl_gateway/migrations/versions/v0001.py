"""Initial cache invalidation cursors; no account or application database references."""

SQL = """
CREATE TABLE gateway_change_cursors (
    owner_user_id VARCHAR(100) NOT NULL PRIMARY KEY,
    revision INTEGER NOT NULL,
    updated_at DATETIME NOT NULL
);
CREATE TABLE gateway_change_receipts (
    service_id VARCHAR(64) NOT NULL,
    event_id VARCHAR(36) NOT NULL,
    owner_user_id VARCHAR(100) NOT NULL,
    revision INTEGER NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (service_id, event_id)
);
CREATE INDEX ix_gateway_change_receipts_owner_user_id
    ON gateway_change_receipts (owner_user_id);
"""
