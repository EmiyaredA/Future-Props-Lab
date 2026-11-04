"""Persist Visual editing batch receipts in the owner's database."""

SQL = """
CREATE TABLE project_operation_receipts (
    owner_user_id VARCHAR(36) NOT NULL,
    resource_kind VARCHAR(40) NOT NULL,
    resource_id VARCHAR(64) NOT NULL,
    request_id VARCHAR(64) NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    result JSON NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (owner_user_id, resource_kind, resource_id, request_id),
    CHECK (resource_kind = 'visual')
);
"""
