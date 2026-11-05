"""Persist exact historical output manifests and per-batch receipts."""

SQL = """
CREATE TABLE rendering_history_manifests (
    owner_user_id VARCHAR(36) NOT NULL,
    dataset VARCHAR(64) NOT NULL,
    id VARCHAR(128) NOT NULL,
    manifest JSON NOT NULL,
    PRIMARY KEY (owner_user_id, dataset, id)
);
CREATE TABLE rendering_migration_receipts (
    run_id VARCHAR(36) NOT NULL,
    dataset VARCHAR(64) NOT NULL,
    owner_user_id VARCHAR(36) NOT NULL,
    batch_id VARCHAR(36) NOT NULL,
    receipt JSON NOT NULL,
    PRIMARY KEY (run_id, dataset, owner_user_id, batch_id)
);
"""
