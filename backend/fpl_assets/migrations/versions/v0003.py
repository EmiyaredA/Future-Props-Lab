"""File-library project placement belongs to Assets, with opaque source project IDs."""

SQL = """
CREATE TABLE asset_visual_project_links (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL,
    asset_id VARCHAR(36) NOT NULL REFERENCES visual_assets(id) ON DELETE RESTRICT,
    folder_id VARCHAR(36) REFERENCES visual_asset_folders(id) ON DELETE CASCADE,
    display_name VARCHAR(255) NOT NULL,
    revision INTEGER NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE(owner_user_id, project_id, asset_id)
);
CREATE INDEX ix_asset_visual_project_links_owner_user_id
    ON asset_visual_project_links(owner_user_id);
CREATE INDEX ix_asset_visual_project_links_asset_id ON asset_visual_project_links(asset_id);
CREATE INDEX ix_asset_visual_project_links_project_folder
    ON asset_visual_project_links(owner_user_id, project_id, folder_id);
"""
