"""Exact-content index and durable material consolidation operations."""

MIGRATION_ID = "0139_asset_content_identity"

SQL = """
CREATE TABLE asset_content_fingerprints (
    asset_id VARCHAR(36) NOT NULL PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    descriptor JSON NOT NULL,
    sha256 VARCHAR(64) NOT NULL,
    FOREIGN KEY(asset_id) REFERENCES visual_assets(id) ON DELETE CASCADE
);
CREATE INDEX ix_asset_content_fingerprints_owner_user_id
    ON asset_content_fingerprints(owner_user_id);
CREATE INDEX ix_asset_content_fingerprints_sha256 ON asset_content_fingerprints(sha256);
CREATE TABLE asset_dedupe_operations (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    request_id VARCHAR(80) NOT NULL,
    revision INTEGER NOT NULL,
    document JSON NOT NULL,
    created_at DATETIME NOT NULL,
    UNIQUE(owner_user_id, request_id)
);
CREATE INDEX ix_asset_dedupe_operations_owner_user_id ON asset_dedupe_operations(owner_user_id);
CREATE TABLE asset_dedupe_canonical_pins (
    operation_id VARCHAR(36) NOT NULL,
    content_key VARCHAR(64) NOT NULL,
    owner_user_id VARCHAR(36) NOT NULL,
    asset_id VARCHAR(36) NOT NULL,
    PRIMARY KEY(operation_id, content_key),
    FOREIGN KEY(asset_id) REFERENCES visual_assets(id) ON DELETE RESTRICT
);
CREATE INDEX ix_asset_dedupe_canonical_pins_owner_user_id ON asset_dedupe_canonical_pins(owner_user_id);
CREATE INDEX ix_asset_dedupe_canonical_pins_asset_id ON asset_dedupe_canonical_pins(asset_id);
"""
