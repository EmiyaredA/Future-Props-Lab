MIGRATION_ID = "r0019_project_storage_layout"

SQL = r"""
ALTER TABLE visual_assets
  ADD COLUMN storage_version INTEGER NOT NULL DEFAULT 1
    CHECK (storage_version IN (1, 2));

CREATE INDEX ix_visual_assets_storage_version
  ON visual_assets(storage_version, created_at);
"""
