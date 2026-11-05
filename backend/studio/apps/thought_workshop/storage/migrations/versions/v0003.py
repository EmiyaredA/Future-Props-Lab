"""Persist upload intents without storing browser credentials."""

SQL = """
CREATE TABLE thought_upload_intents (
    owner_user_id VARCHAR(36) NOT NULL,
    request_id VARCHAR(128) NOT NULL,
    descriptor_sha256 VARCHAR(64) NOT NULL,
    descriptor JSON NOT NULL,
    state VARCHAR(16) NOT NULL,
    result JSON,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (owner_user_id, request_id)
);
"""
