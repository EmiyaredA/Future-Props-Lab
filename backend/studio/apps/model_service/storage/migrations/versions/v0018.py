"""Own the exact result and unknown state of each fixed visual model review."""

SQL = """
CREATE TABLE model_visual_review_attempts (
    owner_user_id VARCHAR(36) NOT NULL,
    run_id VARCHAR(128) NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    state VARCHAR(16) NOT NULL CHECK(state IN ('running', 'completed', 'failed', 'unknown')),
    outcome JSON,
    lease_id VARCHAR(36) NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY(owner_user_id, run_id)
);
"""
