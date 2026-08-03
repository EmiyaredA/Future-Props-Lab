MIGRATION_ID = "r0006_file_management"

SQL = r"""
CREATE TABLE visual_asset_folders (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36),
  parent_id VARCHAR(36),
  name VARCHAR(120) NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES visual_workshop_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES visual_asset_folders(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX ux_visual_asset_folders_scope_parent_name
  ON visual_asset_folders (
    ifnull(project_id, ''), ifnull(parent_id, ''), lower(name)
  );
CREATE INDEX ix_visual_asset_folders_project_parent
  ON visual_asset_folders(project_id, parent_id, created_at);

CREATE TABLE visual_assets (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36),
  folder_id VARCHAR(36),
  original_filename VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 255),
  storage_key VARCHAR(64) NOT NULL UNIQUE,
  media_kind VARCHAR(16) NOT NULL
    CHECK (media_kind IN ('image', 'video', 'audio', 'document')),
  mime_type VARCHAR(120) NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES visual_workshop_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (folder_id) REFERENCES visual_asset_folders(id) ON DELETE CASCADE
);
CREATE INDEX ix_visual_assets_project_folder_updated
  ON visual_assets(project_id, folder_id, updated_at DESC, created_at DESC);

CREATE TABLE visual_project_asset_references (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  asset_id VARCHAR(36) NOT NULL,
  folder_id VARCHAR(36),
  display_name VARCHAR(255) NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 255),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES visual_workshop_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES visual_assets(id) ON DELETE RESTRICT,
  FOREIGN KEY (folder_id) REFERENCES visual_asset_folders(id) ON DELETE CASCADE,
  UNIQUE (project_id, asset_id)
);
CREATE INDEX ix_visual_project_asset_references_folder
  ON visual_project_asset_references(project_id, folder_id, updated_at DESC);
"""
