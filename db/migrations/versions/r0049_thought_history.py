"""Immutable document history and attachment retention."""

MIGRATION_ID = "0049_thought_history"

SQL = """
CREATE TABLE thought_note_history (
 id VARCHAR(36) PRIMARY KEY,
 note_id VARCHAR(36) NOT NULL REFERENCES thought_notes(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL,
 title VARCHAR(240) NOT NULL,
 document JSON NOT NULL,
 schema_version INTEGER NOT NULL,
 tags JSON NOT NULL,
 author_id VARCHAR(36),
 author_name VARCHAR(120) NOT NULL,
 source VARCHAR(20) NOT NULL,
 created_at DATETIME NOT NULL,
 UNIQUE(note_id, revision)
);
CREATE INDEX ix_thought_history_note_revision ON thought_note_history(note_id, revision);
CREATE TABLE thought_history_assets (
 history_id VARCHAR(36) NOT NULL REFERENCES thought_note_history(id) ON DELETE CASCADE,
 asset_id VARCHAR(36) NOT NULL REFERENCES visual_assets(id) ON DELETE RESTRICT,
 PRIMARY KEY(history_id, asset_id)
);
CREATE INDEX ix_thought_history_assets_asset ON thought_history_assets(asset_id);
INSERT INTO thought_note_history
 SELECT id, id, revision, title, document, schema_version, tags, NULL, '未知编辑者',
 'baseline', updated_at FROM thought_notes;
INSERT INTO thought_history_assets SELECT note_id, asset_id FROM thought_note_assets;
"""
