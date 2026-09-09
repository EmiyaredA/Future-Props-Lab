# ruff: noqa: E501
"""Workspace-owned rich-text notes and managed image references."""

MIGRATION_ID = "0044_thought_workshop"
SQL = """
CREATE TABLE thought_notebooks (
 id VARCHAR(36) PRIMARY KEY, workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 title VARCHAR(120) NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
 created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL
);
CREATE INDEX ix_thought_notebooks_workspace ON thought_notebooks(workspace_id);
CREATE TABLE thought_notes (
 id VARCHAR(36) PRIMARY KEY, workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 notebook_id VARCHAR(36) REFERENCES thought_notebooks(id) ON DELETE SET NULL,
 title VARCHAR(240) NOT NULL, document JSON NOT NULL, schema_version INTEGER NOT NULL DEFAULT 1,
 search_text TEXT NOT NULL DEFAULT '', tags JSON NOT NULL DEFAULT '[]',
 pinned BOOLEAN NOT NULL DEFAULT 0, favorite BOOLEAN NOT NULL DEFAULT 0,
 deleted_at DATETIME, revision INTEGER NOT NULL DEFAULT 0,
 created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL
);
CREATE INDEX ix_thought_notes_workspace_updated ON thought_notes(workspace_id, updated_at);
CREATE INDEX ix_thought_notes_notebook ON thought_notes(notebook_id);
CREATE TABLE thought_note_assets (
 note_id VARCHAR(36) NOT NULL REFERENCES thought_notes(id) ON DELETE CASCADE,
 asset_id VARCHAR(36) NOT NULL REFERENCES visual_assets(id) ON DELETE RESTRICT,
 PRIMARY KEY(note_id, asset_id)
);
CREATE INDEX ix_thought_note_assets_asset ON thought_note_assets(asset_id);
"""
