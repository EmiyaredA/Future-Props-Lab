"""Durable, owner-scoped acknowledgements for Thought upload requests."""

SQL = """
CREATE TABLE asset_thought_upload_receipts (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    request_id VARCHAR(128) NOT NULL,
    descriptor_sha256 VARCHAR(64) NOT NULL,
    result JSON NOT NULL,
    created_at DATETIME NOT NULL,
    UNIQUE(owner_user_id, request_id)
);
CREATE INDEX ix_asset_thought_upload_receipts_owner_user_id
    ON asset_thought_upload_receipts(owner_user_id);
"""
