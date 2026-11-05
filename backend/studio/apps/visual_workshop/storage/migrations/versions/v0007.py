"""Persist deterministic composition attempts until their result is published."""

SQL = """
CREATE TABLE visual_composition_dispatches (
    batch_id VARCHAR(36) PRIMARY KEY REFERENCES visual_generation_batches(id) ON DELETE CASCADE,
    owner_user_id VARCHAR(36) NOT NULL,
    source_path TEXT NOT NULL,
    assertion TEXT NOT NULL,
    plan JSON NOT NULL,
    pending_asset_id VARCHAR(36),
    pending_receipt_id VARCHAR(128),
    checked_at DATETIME NOT NULL,
    CHECK((pending_asset_id IS NULL) = (pending_receipt_id IS NULL))
);
CREATE INDEX ix_visual_composition_dispatches_checked_at
    ON visual_composition_dispatches(checked_at);
"""
