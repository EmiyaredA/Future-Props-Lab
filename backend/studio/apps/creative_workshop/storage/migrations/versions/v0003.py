"""Prevent withdrawal while an accepted installation can still commit."""

SQL = """
CREATE TABLE creative_install_fences (
  operation_id VARCHAR(36) NOT NULL
    REFERENCES creative_install_operations(operation_id) ON DELETE RESTRICT,
  item_id VARCHAR(36) NOT NULL REFERENCES creative_items(id) ON DELETE RESTRICT,
  PRIMARY KEY (operation_id, item_id)
);
CREATE INDEX ix_creative_install_fences_item_id ON creative_install_fences(item_id);
"""
