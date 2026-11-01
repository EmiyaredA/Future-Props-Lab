"""Optional transparent inspection video, separate from the canonical output."""

MIGRATION_ID = "0115_visual_output_inspection"
SQL = """
ALTER TABLE visual_node_outputs ADD COLUMN inspection_asset_id VARCHAR(36)
  REFERENCES visual_assets(id) ON DELETE RESTRICT;
"""
