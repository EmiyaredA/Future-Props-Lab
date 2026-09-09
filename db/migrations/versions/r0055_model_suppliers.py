"""Explicit supplier groups; preserve all existing connections and model identities."""

MIGRATION_ID = "r0055_model_suppliers"

SQL = """
CREATE TABLE model_suppliers (
    id VARCHAR(36) PRIMARY KEY NOT NULL,
    workspace_id VARCHAR(36) NOT NULL,
    name VARCHAR(120) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    origin VARCHAR(24) NOT NULL DEFAULT 'user',
    template_key VARCHAR(160),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (workspace_id, template_key)
);
CREATE INDEX ix_model_suppliers_workspace_id ON model_suppliers (workspace_id);
ALTER TABLE model_providers ADD COLUMN supplier_id VARCHAR(36)
    REFERENCES model_suppliers(id) ON DELETE RESTRICT;
CREATE INDEX ix_model_providers_supplier_id ON model_providers (supplier_id);
"""
