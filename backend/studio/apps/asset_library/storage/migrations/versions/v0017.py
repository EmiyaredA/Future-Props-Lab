"""Durable staging for Visual uploads before committing the source Canvas."""

SQL = """
CREATE TABLE asset_visual_upload_stages (
    intent_id VARCHAR(36) NOT NULL PRIMARY KEY
        REFERENCES asset_reference_intents(id) ON DELETE RESTRICT,
    owner_user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(128) NOT NULL,
    descriptor JSON NOT NULL,
    storage_keys JSON NOT NULL,
    originals JSON NOT NULL,
    state VARCHAR(16) NOT NULL CHECK (
        state IN ('reserved','writing','sealed','published','canceling','aborted')
    )
);
CREATE INDEX ix_asset_visual_upload_stages_owner_user_id
    ON asset_visual_upload_stages(owner_user_id);
"""
