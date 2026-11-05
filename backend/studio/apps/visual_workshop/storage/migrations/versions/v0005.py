"""Track Visual history batches and remove the empty legacy placement table."""

SQL = """
CREATE TABLE visual_legacy_links_check (
    record_count INTEGER NOT NULL CHECK (record_count = 0)
);
INSERT INTO visual_legacy_links_check SELECT COUNT(*) FROM visual_project_asset_references;
DROP TABLE visual_project_asset_references;
DROP TABLE visual_legacy_links_check;
CREATE TABLE visual_migration_receipts (
    run_id VARCHAR(36) NOT NULL,
    dataset VARCHAR(64) NOT NULL,
    owner_user_id VARCHAR(36) NOT NULL,
    batch_id VARCHAR(36) NOT NULL,
    receipt JSON NOT NULL,
    PRIMARY KEY (run_id, dataset, owner_user_id, batch_id)
);
"""
