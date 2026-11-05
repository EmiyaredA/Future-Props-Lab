"""Community attachment decisions commit with the source-side article linkage."""

SQL = """
CREATE TABLE thought_community_upload_intents (
    owner_user_id VARCHAR(36) NOT NULL,
    batch_id VARCHAR(32) NOT NULL,
    request_key VARCHAR(64),
    request_sha256 VARCHAR(64) NOT NULL,
    source_sha256 VARCHAR(64) NOT NULL,
    scope JSON NOT NULL,
    manifest_sha256 VARCHAR(64),
    state VARCHAR(16) NOT NULL
        CHECK(state IN ('staging', 'retry', 'commit', 'abort', 'published', 'discarded')),
    result JSON,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (owner_user_id, batch_id),
    UNIQUE (owner_user_id, request_key)
);
CREATE INDEX ix_thought_community_upload_intents_pending
    ON thought_community_upload_intents(state, updated_at);
CREATE INDEX ix_thought_community_upload_intents_request_sha256
    ON thought_community_upload_intents(request_sha256);
"""
