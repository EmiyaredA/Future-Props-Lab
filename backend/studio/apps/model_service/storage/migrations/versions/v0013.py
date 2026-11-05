"""Persist a segment execution attempt before calling any transcription provider."""

SQL = """
CREATE TABLE model_annotation_transcription_attempts (
    owner_user_id VARCHAR(36) NOT NULL,
    attempt_id VARCHAR(36) NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    result JSON,
    error JSON,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (owner_user_id, attempt_id)
);
"""
