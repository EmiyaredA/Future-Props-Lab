"""Store one immutable file and inspection receipt per Galgame upload batch."""

SQL = """
CREATE TABLE asset_galgame_upload_receipts (
    owner_user_id VARCHAR(36) NOT NULL,
    request_id VARCHAR(32) NOT NULL,
    project_id VARCHAR(36) NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    result JSON NOT NULL,
    PRIMARY KEY (owner_user_id, request_id)
);
CREATE TABLE asset_galgame_upload_stages (
    owner_user_id VARCHAR(36) NOT NULL,
    request_id VARCHAR(32) NOT NULL,
    project_id VARCHAR(36) NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    storage_keys JSON NOT NULL,
    state VARCHAR(16) NOT NULL,
    PRIMARY KEY (owner_user_id, request_id)
);
"""
