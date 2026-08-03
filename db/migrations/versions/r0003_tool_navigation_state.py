MIGRATION_ID = "r0003_tool_navigation_state"

SQL = r"""
CREATE TABLE tool_navigation_items (
  tool_id VARCHAR(64) PRIMARY KEY,
  is_favorite BOOLEAN NOT NULL DEFAULT FALSE
    CHECK (is_favorite IN (0, 1)),
  favorite_updated_at TIMESTAMP,
  last_used_at TIMESTAMP,
  use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_tool_navigation_items_last_used_at
  ON tool_navigation_items(last_used_at DESC);
"""
