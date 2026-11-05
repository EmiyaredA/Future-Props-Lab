"""Track Video media jobs until Rendering confirms cleanup."""

SQL = """
CREATE TABLE video_media_dispatches (
    task_id VARCHAR(36) PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL,
    asset_id VARCHAR(36) NOT NULL,
    checked_at DATETIME NOT NULL
);
CREATE INDEX ix_video_media_dispatch_checked ON video_media_dispatches(checked_at);
CREATE INDEX ix_video_media_dispatch_project_asset ON video_media_dispatches(project_id, asset_id);
"""
