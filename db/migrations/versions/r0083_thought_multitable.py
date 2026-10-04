"""Typed table documents, records and reversible history in the existing SQLite."""

MIGRATION_ID = "0083_thought_multitable"
SQL = """
ALTER TABLE thought_notes ADD COLUMN kind VARCHAR(20) NOT NULL DEFAULT 'note'
 CHECK(kind IN ('note', 'multitable'));
ALTER TABLE thought_templates ADD COLUMN kind VARCHAR(20) NOT NULL DEFAULT 'note';
ALTER TABLE thought_templates ADD COLUMN multitable JSON;
CREATE TABLE thought_data_tables (
 id VARCHAR(36) PRIMARY KEY,
 note_id VARCHAR(36) NOT NULL REFERENCES thought_notes(id) ON DELETE CASCADE,
 name VARCHAR(120) NOT NULL, position INTEGER NOT NULL);
CREATE INDEX ix_thought_data_tables_note ON thought_data_tables(note_id);
CREATE TABLE thought_data_fields (
 id VARCHAR(36) PRIMARY KEY,
 table_id VARCHAR(36) NOT NULL REFERENCES thought_data_tables(id) ON DELETE CASCADE,
 name VARCHAR(120) NOT NULL,
 type VARCHAR(20) NOT NULL, position INTEGER NOT NULL, options JSON NOT NULL);
CREATE INDEX ix_thought_data_fields_table ON thought_data_fields(table_id);
CREATE TABLE thought_data_views (
 id VARCHAR(36) PRIMARY KEY,
 table_id VARCHAR(36) NOT NULL REFERENCES thought_data_tables(id) ON DELETE CASCADE,
 name VARCHAR(120) NOT NULL,
 type VARCHAR(20) NOT NULL, position INTEGER NOT NULL, config JSON NOT NULL);
CREATE INDEX ix_thought_data_views_table ON thought_data_views(table_id);
CREATE TABLE thought_data_records (
 id VARCHAR(36) PRIMARY KEY,
 table_id VARCHAR(36) NOT NULL REFERENCES thought_data_tables(id) ON DELETE CASCADE,
 position INTEGER NOT NULL, "values" JSON NOT NULL);
CREATE INDEX ix_thought_data_records_table ON thought_data_records(table_id, position);
CREATE TABLE thought_data_changes (
 id VARCHAR(36) PRIMARY KEY,
 note_id VARCHAR(36) NOT NULL REFERENCES thought_notes(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL, changes JSON NOT NULL, checkpoint JSON,
 author_id VARCHAR(36), created_at DATETIME NOT NULL, UNIQUE(note_id, revision));
CREATE TABLE thought_data_assets (
 note_id VARCHAR(36) NOT NULL REFERENCES thought_notes(id) ON DELETE CASCADE,
 asset_id VARCHAR(36) NOT NULL REFERENCES visual_assets(id) ON DELETE RESTRICT,
 PRIMARY KEY(note_id, asset_id));
"""
