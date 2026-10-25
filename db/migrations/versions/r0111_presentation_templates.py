"""Workspace template and example libraries; old documents remain untouched."""

MIGRATION_ID = "r0111_presentation_templates"
SQL = """
CREATE TABLE presentation_templates (
 id VARCHAR(36) PRIMARY KEY,
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 title VARCHAR(120) NOT NULL,
 description VARCHAR(1000) NOT NULL DEFAULT '',
 definition JSON NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
 created_at TIMESTAMP NOT NULL,
 updated_at TIMESTAMP NOT NULL
);
CREATE INDEX ix_presentation_templates_workspace_updated 
 ON presentation_templates(workspace_id, updated_at);
CREATE TABLE presentation_examples (
 id VARCHAR(36) PRIMARY KEY,
 workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 title VARCHAR(120) NOT NULL,
 description VARCHAR(1000) NOT NULL DEFAULT '',
 document JSON NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
 created_at TIMESTAMP NOT NULL,
 updated_at TIMESTAMP NOT NULL
);
CREATE INDEX ix_presentation_examples_workspace_updated 
 ON presentation_examples(workspace_id, updated_at);
CREATE TABLE presentation_template_assets (
 template_id VARCHAR(36) NOT NULL REFERENCES presentation_templates(id) ON DELETE CASCADE,
 asset_id VARCHAR(36) NOT NULL REFERENCES visual_assets(id) ON DELETE RESTRICT,
 PRIMARY KEY(template_id, asset_id)
);
CREATE INDEX ix_presentation_template_assets_asset ON presentation_template_assets(asset_id);
CREATE TABLE presentation_example_assets (
 example_id VARCHAR(36) NOT NULL REFERENCES presentation_examples(id) ON DELETE CASCADE,
 asset_id VARCHAR(36) NOT NULL REFERENCES visual_assets(id) ON DELETE RESTRICT,
 PRIMARY KEY(example_id, asset_id)
);
CREATE INDEX ix_presentation_example_assets_asset ON presentation_example_assets(asset_id);
"""
