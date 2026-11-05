"""Add idempotent Motion asset upload and copy receipts."""

SQL = """
CREATE TABLE asset_motion_file_write_receipts (
    owner_user_id VARCHAR(36) NOT NULL,
    request_id VARCHAR(32) NOT NULL,
    project_id VARCHAR(36) NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    result JSON NOT NULL,
    PRIMARY KEY (owner_user_id, request_id)
);
"""
