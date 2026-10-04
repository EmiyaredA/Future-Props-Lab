"""Knowledge community registry and per-article grants; source content stays in place."""

MIGRATION_ID = "0082_thought_publications"
SQL = """
CREATE TABLE thought_publications (
 id VARCHAR(36) PRIMARY KEY,
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 knowledge_base_id VARCHAR(36) NOT NULL UNIQUE
 REFERENCES thought_knowledge_bases(id) ON DELETE CASCADE,
 publisher_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 title VARCHAR(240) NOT NULL, description TEXT NOT NULL,
 cover_asset_id VARCHAR(36) REFERENCES visual_assets(id) ON DELETE RESTRICT,
 active BOOLEAN NOT NULL, revision INTEGER NOT NULL, updated_at DATETIME NOT NULL
);
CREATE INDEX ix_thought_publications_workspace ON thought_publications(workspace_id);
CREATE TABLE thought_published_articles (
 publication_id VARCHAR(36) NOT NULL REFERENCES thought_publications(id) ON DELETE CASCADE,
 note_id VARCHAR(36) NOT NULL REFERENCES thought_notes(id) ON DELETE CASCADE,
 visibility VARCHAR(16) NOT NULL CHECK(visibility IN ('public','members')),
 active BOOLEAN NOT NULL, revision INTEGER NOT NULL,
 PRIMARY KEY(publication_id,note_id)
);
CREATE TABLE thought_article_members (
 publication_id VARCHAR(36) NOT NULL REFERENCES thought_publications(id) ON DELETE CASCADE,
 note_id VARCHAR(36) NOT NULL REFERENCES thought_notes(id) ON DELETE CASCADE,
 user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 role VARCHAR(16) NOT NULL CHECK(role IN ('read','edit','manage')),
 PRIMARY KEY(publication_id,note_id,user_id)
);
CREATE TABLE thought_community_favorites (
 user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 resource_id VARCHAR(200) NOT NULL, PRIMARY KEY(user_id,resource_id)
);
CREATE TABLE thought_community_uploads (
 note_id VARCHAR(36) NOT NULL REFERENCES thought_notes(id) ON DELETE CASCADE,
 asset_id VARCHAR(36) NOT NULL REFERENCES visual_assets(id) ON DELETE CASCADE,
 user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 PRIMARY KEY(note_id,asset_id)
);
"""
