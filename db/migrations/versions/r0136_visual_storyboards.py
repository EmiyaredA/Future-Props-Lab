"""Register storyboard persistence in the compatible website database."""

MIGRATION_ID = "0136_visual_storyboards"

SQL = """
CREATE TABLE visual_storyboards (
    project_id VARCHAR(36) PRIMARY KEY NOT NULL
        REFERENCES visual_workshop_projects(id) ON DELETE CASCADE,
    shots JSON NOT NULL,
    revision INTEGER NOT NULL
);
"""
