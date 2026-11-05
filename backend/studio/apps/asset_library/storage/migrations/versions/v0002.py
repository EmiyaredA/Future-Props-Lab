"""Durable prospective pins; pending source outcomes are never released by a timer."""

SQL = """
ALTER TABLE asset_reference_sets ADD COLUMN deleted BOOLEAN NOT NULL DEFAULT 0;
CREATE TABLE asset_reference_intents (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    service_id VARCHAR(64) NOT NULL,
    request_id VARCHAR(128) NOT NULL,
    reference_set_id VARCHAR(36) NOT NULL REFERENCES asset_reference_sets(id),
    expected_resource_revision INTEGER NOT NULL,
    payload_sha256 VARCHAR(64) NOT NULL,
    state VARCHAR(16) NOT NULL,
    prepared_result JSON NOT NULL,
    committed_revision INTEGER,
    committed_deleted BOOLEAN,
    committed_result JSON,
    aborted_result JSON,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE(owner_user_id, service_id, request_id)
);
CREATE INDEX ix_asset_reference_intents_owner_user_id ON asset_reference_intents(owner_user_id);
CREATE INDEX ix_asset_reference_intents_state ON asset_reference_intents(state);
CREATE TABLE asset_prepared_pins (
    intent_id VARCHAR(36) NOT NULL REFERENCES asset_reference_intents(id) ON DELETE CASCADE,
    asset_id VARCHAR(36) NOT NULL REFERENCES visual_assets(id) ON DELETE RESTRICT,
    owner_user_id VARCHAR(36) NOT NULL,
    PRIMARY KEY(intent_id, asset_id)
);
CREATE INDEX ix_asset_prepared_pins_asset_id ON asset_prepared_pins(asset_id);
CREATE INDEX ix_asset_prepared_pins_owner_user_id ON asset_prepared_pins(owner_user_id);
"""
