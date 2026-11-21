"""Project-local scene and actor bindings."""

MIGRATION_ID = "0137_visual_creation_links"
SQL = """
CREATE TABLE visual_creation_links (
    project_id VARCHAR(36) PRIMARY KEY NOT NULL
        REFERENCES visual_workshop_projects(id) ON DELETE CASCADE,
    scenes JSON NOT NULL,
    objects JSON NOT NULL,
    revision INTEGER NOT NULL
);
"""
