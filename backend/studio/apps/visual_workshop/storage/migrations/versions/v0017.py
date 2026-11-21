"""Project-local creative connections; existing records are unchanged."""

SQL = """
CREATE TABLE visual_creation_links (
    project_id VARCHAR(36) PRIMARY KEY NOT NULL
        REFERENCES visual_workshop_projects(id) ON DELETE CASCADE,
    scenes JSON NOT NULL,
    objects JSON NOT NULL,
    revision INTEGER NOT NULL
);
"""
