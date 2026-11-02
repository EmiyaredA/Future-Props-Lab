"""Owned files and cross-service retention. External project IDs are opaque."""

SQL = """
CREATE TABLE visual_asset_folders (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36),
    parent_id VARCHAR(36) REFERENCES visual_asset_folders(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    revision INTEGER NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);
CREATE INDEX ix_visual_asset_folders_owner_user_id ON visual_asset_folders(owner_user_id);
CREATE INDEX ix_visual_asset_folders_project_parent
    ON visual_asset_folders(project_id, parent_id, created_at);
CREATE UNIQUE INDEX ux_visual_asset_folders_scope_parent_name
    ON visual_asset_folders(
        owner_user_id, ifnull(project_id, ''), ifnull(parent_id, ''), lower(name)
    );
CREATE TABLE visual_assets (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36),
    galgame_project_id VARCHAR(36),
    video_editor_project_id VARCHAR(36),
    motion_compositor_project_id VARCHAR(36),
    folder_id VARCHAR(36) REFERENCES visual_asset_folders(id) ON DELETE CASCADE,
    original_filename VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    storage_key VARCHAR(64) NOT NULL UNIQUE,
    storage_version INTEGER NOT NULL,
    media_kind VARCHAR(16) NOT NULL,
    mime_type VARCHAR(120) NOT NULL,
    byte_size INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);
CREATE INDEX ix_visual_assets_owner_user_id ON visual_assets(owner_user_id);
CREATE INDEX ix_visual_assets_project_folder_updated
    ON visual_assets(project_id, folder_id, updated_at, created_at);
CREATE INDEX ix_visual_assets_video_editor_project
    ON visual_assets(video_editor_project_id, updated_at);
CREATE INDEX ix_visual_assets_motion_project
    ON visual_assets(motion_compositor_project_id, updated_at);
CREATE TABLE asset_reference_sets (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    service_id VARCHAR(64) NOT NULL,
    resource_kind VARCHAR(64) NOT NULL,
    resource_id VARCHAR(128) NOT NULL,
    resource_revision INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE(owner_user_id, service_id, resource_kind, resource_id)
);
CREATE INDEX ix_asset_reference_sets_owner_user_id ON asset_reference_sets(owner_user_id);
CREATE TABLE asset_reference_pins (
    reference_set_id VARCHAR(36) NOT NULL REFERENCES asset_reference_sets(id) ON DELETE CASCADE,
    asset_id VARCHAR(36) NOT NULL REFERENCES visual_assets(id) ON DELETE RESTRICT,
    owner_user_id VARCHAR(36) NOT NULL,
    PRIMARY KEY(reference_set_id, asset_id)
);
CREATE INDEX ix_asset_reference_pins_owner_user_id ON asset_reference_pins(owner_user_id);
CREATE INDEX ix_asset_reference_pins_asset_id ON asset_reference_pins(asset_id);
CREATE TABLE asset_reference_receipts (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    service_id VARCHAR(64) NOT NULL,
    request_id VARCHAR(128) NOT NULL,
    payload_sha256 VARCHAR(64) NOT NULL,
    result JSON NOT NULL,
    created_at DATETIME NOT NULL,
    UNIQUE(owner_user_id, service_id, request_id)
);
CREATE INDEX ix_asset_reference_receipts_owner_user_id ON asset_reference_receipts(owner_user_id);
CREATE TABLE asset_file_deletions (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    owner_user_id VARCHAR(36) NOT NULL,
    asset_id VARCHAR(36) NOT NULL UNIQUE,
    asset_snapshot JSON NOT NULL,
    status VARCHAR(16) NOT NULL,
    error_code VARCHAR(64) NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);
CREATE INDEX ix_asset_file_deletions_owner_user_id ON asset_file_deletions(owner_user_id);
CREATE INDEX ix_asset_file_deletions_status ON asset_file_deletions(status);
"""
