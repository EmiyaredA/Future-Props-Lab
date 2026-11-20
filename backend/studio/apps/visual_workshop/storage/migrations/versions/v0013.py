# ruff: noqa: E501
SQL = """
CREATE TABLE visual_scripts (
    project_id VARCHAR(36) PRIMARY KEY NOT NULL REFERENCES visual_workshop_projects(id) ON DELETE CASCADE,
    episodes JSON NOT NULL,
    revision INTEGER NOT NULL
);
CREATE TABLE visual_asset_cards (
    id VARCHAR(36) PRIMARY KEY NOT NULL,
    project_id VARCHAR(36) NOT NULL REFERENCES visual_workshop_projects(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    data JSON NOT NULL
);
CREATE INDEX ix_visual_asset_cards_project_id ON visual_asset_cards(project_id);
ALTER TABLE visual_previs_scenes ADD COLUMN script_source JSON;
"""
