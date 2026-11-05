"""Account-bound immutable Creative batch and release receipts."""

SQL = """
CREATE TABLE integration_creative_install_receipts (
    id VARCHAR(36) PRIMARY KEY NOT NULL,
    owner_user_id VARCHAR(36) NOT NULL,
    operation_id VARCHAR(100) NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    result JSON NOT NULL,
    created_at DATETIME NOT NULL,
    UNIQUE (owner_user_id, operation_id)
);
CREATE INDEX ix_integration_creative_install_receipts_owner_user_id
    ON integration_creative_install_receipts (owner_user_id);
CREATE TABLE integration_creative_installed_parts (
    id VARCHAR(36) PRIMARY KEY NOT NULL,
    owner_user_id VARCHAR(36) NOT NULL,
    release_id VARCHAR(100) NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    description VARCHAR(500) NOT NULL,
    result JSON NOT NULL,
    setup_fingerprint VARCHAR(64) NOT NULL,
    created_at DATETIME NOT NULL,
    UNIQUE (owner_user_id, release_id)
);
CREATE INDEX ix_integration_creative_installed_parts_owner_user_id
    ON integration_creative_installed_parts (owner_user_id);
"""
