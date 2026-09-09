# ruff: noqa: E501
"""Convert thought folders into nestable documents under parent_id."""

MIGRATION_ID = "0048_thought_document_tree"

SQL = """
ALTER TABLE thought_notes ADD COLUMN parent_id VARCHAR(36);
INSERT INTO thought_notes(
 id, workspace_id, knowledge_base_id, parent_id, position, is_home, title, document,
 schema_version, search_text, tags, pinned, favorite, deleted_at, revision, created_at, updated_at
)
SELECT f.id, kb.workspace_id, f.knowledge_base_id, f.parent_id, f.position, 0, f.title,
 '{"type":"doc","content":[{"type":"paragraph"}]}', 2, '', '[]', 0, 0, NULL, 0,
 f.created_at, f.updated_at
FROM thought_folders f
JOIN thought_knowledge_bases kb ON kb.id = f.knowledge_base_id;
UPDATE thought_notes SET parent_id = folder_id WHERE folder_id IS NOT NULL;
CREATE TABLE thought_notes_new (
 id VARCHAR(36) PRIMARY KEY,
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 knowledge_base_id VARCHAR(36) NOT NULL REFERENCES thought_knowledge_bases(id) ON DELETE CASCADE,
 parent_id VARCHAR(36) REFERENCES thought_notes(id) ON DELETE SET NULL,
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
 SELECT id, workspace_id, knowledge_base_id, parent_id, position, is_home, title, document,
 schema_version, search_text, tags, pinned, favorite, deleted_at, revision, created_at, updated_at
 FROM thought_notes;
DROP TABLE thought_notes;
ALTER TABLE thought_notes_new RENAME TO thought_notes;
DROP TABLE thought_folders;
CREATE INDEX ix_thought_notes_workspace_updated ON thought_notes(workspace_id, updated_at);
CREATE INDEX ix_thought_notes_knowledge_base ON thought_notes(knowledge_base_id);
CREATE INDEX ix_thought_notes_parent ON thought_notes(parent_id);
CREATE UNIQUE INDEX ix_thought_notes_home ON thought_notes(knowledge_base_id) WHERE is_home = 1;
"""
