"""Node-owned, read-only-plan acceptance; preserve all legacy review records."""

MIGRATION_ID = "0108_node_acceptance"
SQL = """
CREATE TABLE visual_node_acceptance_bindings (
    id VARCHAR(36) PRIMARY KEY NOT NULL,
    workspace_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36) NOT NULL REFERENCES visual_workshop_projects(id) ON DELETE CASCADE,
    node_id VARCHAR(64) NOT NULL,
    scheme_id VARCHAR(64),
    revision INTEGER NOT NULL DEFAULT 0,
    UNIQUE(project_id, node_id)
);
CREATE INDEX ix_visual_node_acceptance_bindings_workspace_id
ON visual_node_acceptance_bindings(workspace_id);
ALTER TABLE visual_acceptance_runs ADD COLUMN scheme_id VARCHAR(64) NOT NULL DEFAULT 'legacy';
ALTER TABLE visual_acceptance_runs ADD COLUMN execution_result JSON NOT NULL DEFAULT '{}';
"""
