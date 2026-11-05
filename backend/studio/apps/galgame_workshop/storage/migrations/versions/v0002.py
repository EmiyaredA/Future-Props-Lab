"""Persist source outcomes before finalizing remote retention pins."""

SQL = """
CREATE TABLE galgame_story_reference_mutations (
    owner_user_id VARCHAR(36) NOT NULL,
    request_id VARCHAR(128) NOT NULL,
    change_sha256 VARCHAR(64) NOT NULL,
    change JSON NOT NULL,
    authority TEXT NOT NULL,
    state VARCHAR(16) NOT NULL,
    asset_intent_id VARCHAR(128),
    resource_revision INTEGER,
    deleted BOOLEAN NOT NULL,
    delivered_result JSON,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (owner_user_id, request_id)
);
CREATE INDEX ix_galgame_story_reference_mutations_state
    ON galgame_story_reference_mutations (state);
"""
