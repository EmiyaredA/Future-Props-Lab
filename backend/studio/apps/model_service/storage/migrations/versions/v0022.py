SQL = """
CREATE TABLE video_enhancement_tasks (
    id VARCHAR(36) PRIMARY KEY NOT NULL,
    owner_user_id VARCHAR(36) NOT NULL,
    request_id VARCHAR(64) NOT NULL,
    source_id VARCHAR(36) NOT NULL REFERENCES model_inference_assets(id) ON DELETE CASCADE,
    model_id VARCHAR(36) NOT NULL,
    model_revision VARCHAR(64) NOT NULL,
    status VARCHAR(24) NOT NULL,
    video JSON,
    segments JSON,
    completed INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    error_message VARCHAR(512),
    created_at DATETIME NOT NULL,
    UNIQUE(owner_user_id, request_id)
);
CREATE INDEX ix_video_enhancement_owner ON video_enhancement_tasks(owner_user_id);
"""
