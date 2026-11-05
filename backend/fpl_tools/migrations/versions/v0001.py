"""Initialize only the Tools-owned navigation state."""

SQL = """
CREATE TABLE tool_navigation_items (
    owner_user_id VARCHAR(36) NOT NULL,
    tool_id VARCHAR(64) NOT NULL,
    is_favorite BOOLEAN NOT NULL,
    favorite_updated_at DATETIME,
    last_used_at DATETIME,
    use_count INTEGER NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (owner_user_id, tool_id)
);
CREATE INDEX ix_tool_navigation_items_last_used_at ON tool_navigation_items (last_used_at);
"""
