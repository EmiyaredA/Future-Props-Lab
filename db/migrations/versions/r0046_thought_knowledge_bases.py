# ruff: noqa: E501
"""Convert notebook collections into document projects, preserving note identities."""

MIGRATION_ID = "0046_thought_knowledge_bases"

SQL = """
CREATE TABLE thought_knowledge_bases (
 id VARCHAR(36) PRIMARY KEY,
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 title VARCHAR(120) NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 cover_asset_id VARCHAR(36) REFERENCES visual_assets(id) ON DELETE RESTRICT,
 home_note_id VARCHAR(36),
 revision INTEGER NOT NULL DEFAULT 0,
 deleted_at DATETIME,
 created_at DATETIME NOT NULL,
 updated_at DATETIME NOT NULL
);
CREATE INDEX ix_thought_knowledge_bases_workspace ON thought_knowledge_bases(workspace_id);
CREATE TABLE thought_folders (
 id VARCHAR(36) PRIMARY KEY,
 knowledge_base_id VARCHAR(36) NOT NULL REFERENCES thought_knowledge_bases(id) ON DELETE CASCADE,
 parent_id VARCHAR(36) REFERENCES thought_folders(id) ON DELETE CASCADE,
 title VARCHAR(120) NOT NULL,
 position INTEGER NOT NULL DEFAULT 0,
 created_at DATETIME NOT NULL,
 updated_at DATETIME NOT NULL
);
CREATE INDEX ix_thought_folders_knowledge_base ON thought_folders(knowledge_base_id);
CREATE TEMP TABLE thought_migration_projects AS
 SELECT workspace_id, lower(hex(randomblob(16))) AS id,
 lower(hex(randomblob(16))) AS home_id, min(created_at) AS created_at, max(updated_at) AS updated_at
 FROM (SELECT workspace_id, created_at, updated_at FROM thought_notes
 UNION ALL SELECT workspace_id, created_at, updated_at FROM thought_notebooks)
 GROUP BY workspace_id;
INSERT INTO thought_knowledge_bases(id, workspace_id, title, home_note_id, created_at, updated_at)
 SELECT id, workspace_id, '我的知识库', home_id, created_at, updated_at FROM thought_migration_projects;
INSERT INTO thought_folders(id, knowledge_base_id, title, position, created_at, updated_at)
 SELECT b.id, p.id, b.title,
 row_number() OVER (PARTITION BY b.workspace_id ORDER BY b.created_at, b.id)-1,
 b.created_at, b.updated_at FROM thought_notebooks b JOIN thought_migration_projects p USING(workspace_id);
CREATE TABLE thought_notes_new (
 id VARCHAR(36) PRIMARY KEY,
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 knowledge_base_id VARCHAR(36) NOT NULL REFERENCES thought_knowledge_bases(id) ON DELETE CASCADE,
 folder_id VARCHAR(36) REFERENCES thought_folders(id) ON DELETE SET NULL,
 position INTEGER NOT NULL DEFAULT 0,
 is_home BOOLEAN NOT NULL DEFAULT 0,
 title VARCHAR(240) NOT NULL,
 document JSON NOT NULL,
 schema_version INTEGER NOT NULL DEFAULT 2,
 search_text TEXT NOT NULL DEFAULT '',
 tags JSON NOT NULL DEFAULT '[]',
 pinned BOOLEAN NOT NULL DEFAULT 0,
 favorite BOOLEAN NOT NULL DEFAULT 0,
 deleted_at DATETIME,
 revision INTEGER NOT NULL DEFAULT 0,
 created_at DATETIME NOT NULL,
 updated_at DATETIME NOT NULL
);
INSERT INTO thought_notes_new
 SELECT n.id, n.workspace_id, p.id, n.notebook_id,
 row_number() OVER (PARTITION BY n.workspace_id, n.notebook_id ORDER BY n.created_at, n.id)-1,
 0, n.title, n.document, n.schema_version, n.search_text, n.tags, n.pinned, n.favorite,
 n.deleted_at, n.revision, n.created_at, n.updated_at
 FROM thought_notes n JOIN thought_migration_projects p USING(workspace_id);
INSERT INTO thought_notes_new(id, workspace_id, knowledge_base_id, is_home, title, document, created_at, updated_at)
 SELECT home_id, workspace_id, id, 1, '首页', '{"type":"doc","content":[{"type":"paragraph"}]}',
 created_at, updated_at FROM thought_migration_projects;
DROP TABLE thought_notes;
ALTER TABLE thought_notes_new RENAME TO thought_notes;
DROP TABLE thought_notebooks;
DROP TABLE thought_migration_projects;
CREATE INDEX ix_thought_notes_workspace_updated ON thought_notes(workspace_id, updated_at);
CREATE INDEX ix_thought_notes_knowledge_base ON thought_notes(knowledge_base_id);
CREATE INDEX ix_thought_notes_folder ON thought_notes(folder_id);
CREATE UNIQUE INDEX ix_thought_notes_home ON thought_notes(knowledge_base_id) WHERE is_home = 1;
"""
