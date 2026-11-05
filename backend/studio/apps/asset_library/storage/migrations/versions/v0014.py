"""Remember original Video task identifiers for verified historical output receipts."""

SQL = """
CREATE TABLE asset_video_output_history (
    owner_user_id VARCHAR(36) NOT NULL,
    id VARCHAR(36) NOT NULL,
    record JSON NOT NULL,
    PRIMARY KEY (owner_user_id, id)
);
"""
