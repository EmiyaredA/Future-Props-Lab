MIGRATION_ID = "r0017_galgame_character_assets"

SQL = r"""
ALTER TABLE visual_assets
  ADD COLUMN galgame_project_id VARCHAR(36)
    REFERENCES galgame_workshop_projects(id) ON DELETE CASCADE;

CREATE INDEX ix_visual_assets_galgame_project_updated
  ON visual_assets(galgame_project_id, updated_at DESC, created_at DESC);

CREATE TABLE galgame_project_asset_references (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  asset_id VARCHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES galgame_workshop_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES visual_assets(id) ON DELETE RESTRICT,
  UNIQUE (project_id, asset_id)
);
CREATE INDEX ix_galgame_project_asset_references_asset
  ON galgame_project_asset_references(asset_id);
"""
