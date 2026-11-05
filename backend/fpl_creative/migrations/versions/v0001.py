"""Creative-owned tables; external account IDs do not reference Identity storage."""

# ruff: noqa: E501

SQL = """
CREATE TABLE creative_items (
  id VARCHAR(36) PRIMARY KEY,
  origin_owner_user_id VARCHAR(36) NOT NULL,
  author_user_id VARCHAR(36) NOT NULL,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('tool_api', 'mcp', 'skill', 'bundle')),
  status VARCHAR(16) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'withdrawn')),
  title VARCHAR(120) NOT NULL DEFAULT '', summary VARCHAR(500) NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '', tags JSON NOT NULL DEFAULT '[]',
  cover_preset VARCHAR(32) NOT NULL DEFAULT 'sunrise',
  draft_manifest JSON NOT NULL DEFAULT '{}', draft_components JSON NOT NULL DEFAULT '[]',
  draft_cover_path VARCHAR(1024) NOT NULL DEFAULT '', draft_skill_path VARCHAR(1024) NOT NULL DEFAULT '',
  current_release_id VARCHAR(36), revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_creative_items_public ON creative_items(status, kind, updated_at);
CREATE INDEX ix_creative_items_owner ON creative_items(origin_owner_user_id, author_user_id, updated_at);
CREATE TABLE creative_releases (
  id VARCHAR(36) PRIMARY KEY,
  item_id VARCHAR(36) NOT NULL REFERENCES creative_items(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1), title VARCHAR(120) NOT NULL,
  summary VARCHAR(500) NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
  tags JSON NOT NULL DEFAULT '[]', cover_preset VARCHAR(32) NOT NULL DEFAULT 'sunrise',
  cover_path VARCHAR(1024) NOT NULL DEFAULT '', manifest JSON NOT NULL DEFAULT '{}',
  components JSON NOT NULL DEFAULT '[]', skill_path VARCHAR(1024) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE (item_id, version)
);
CREATE INDEX ix_creative_releases_item ON creative_releases(item_id, version);
CREATE TABLE creative_installations (
  id VARCHAR(36) PRIMARY KEY, owner_user_id VARCHAR(36) NOT NULL,
  release_id VARCHAR(36) NOT NULL REFERENCES creative_releases(id) ON DELETE RESTRICT,
  installed_by_user_id VARCHAR(36) NOT NULL, resources JSON NOT NULL DEFAULT '[]',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE (owner_user_id, release_id)
);
CREATE INDEX ix_creative_installations_owner ON creative_installations(owner_user_id, created_at);
"""
