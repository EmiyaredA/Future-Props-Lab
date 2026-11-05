"""A Model owner receipt prevents repeated submissions for the same Galgame voice job."""

SQL = """
CREATE TABLE model_galgame_transcription_attempts (
    owner_user_id VARCHAR(36) NOT NULL,
    task_id VARCHAR(36) NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'unknown')),
    outcome JSON,
    created_at DATETIME NOT NULL,
    PRIMARY KEY(owner_user_id, task_id)
);
CREATE INDEX ix_model_galgame_transcription_attempts_status
    ON model_galgame_transcription_attempts(status);
"""
