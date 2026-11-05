"""Immutable receipts for Identity account-created delivery, never an account authority."""

SQL = """CREATE TABLE model_catalog_provisioning (
    event_id VARCHAR(36) NOT NULL PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL UNIQUE,
    event_revision INTEGER NOT NULL,
    event_digest VARCHAR(64) NOT NULL,
    initialization_role VARCHAR(16) NOT NULL,
    account_revision INTEGER NOT NULL,
    outcome VARCHAR(16) NOT NULL,
    created_at DATETIME NOT NULL
);
"""
