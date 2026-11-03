"""Private Models output acknowledgements share the library file transaction."""

SQL = """
CREATE TABLE asset_model_output_receipts (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    source_task_id VARCHAR(128) NOT NULL,
    descriptor_sha256 VARCHAR(64) NOT NULL,
    content_sha256 VARCHAR(64) NOT NULL,
    result JSON NOT NULL,
    created_at DATETIME NOT NULL,
    UNIQUE(owner_user_id, source_task_id, descriptor_sha256)
);
CREATE INDEX ix_asset_model_output_receipts_owner_user_id
    ON asset_model_output_receipts(owner_user_id);
"""
