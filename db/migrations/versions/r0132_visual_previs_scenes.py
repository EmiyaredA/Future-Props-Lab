MIGRATION_ID = "0132_visual_previs_scenes"

SQL = """
CREATE TABLE visual_previs_scenes (
    id VARCHAR(36) PRIMARY KEY NOT NULL,
    project_id VARCHAR(36) NOT NULL REFERENCES visual_workshop_projects(id) ON DELETE CASCADE,
    title VARCHAR(120) NOT NULL,
    format_version INTEGER NOT NULL,
    document JSON NOT NULL,
    revision INTEGER NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);
CREATE INDEX ix_visual_previs_scenes_project_id ON visual_previs_scenes(project_id);
"""
