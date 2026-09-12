"""Idempotent editing receipts; owner use cases validate resource access before replay."""

MIGRATION_ID = "0059_project_operations"
SQL = """
CREATE TABLE project_operation_receipts (
    workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    resource_kind VARCHAR(40) NOT NULL,
    resource_id VARCHAR(64) NOT NULL,
    request_id VARCHAR(64) NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    result JSON NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (workspace_id, resource_kind, resource_id, request_id)
);
"""
