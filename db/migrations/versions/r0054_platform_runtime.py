MIGRATION_ID = "r0054_platform_runtime"
SQL = """
ALTER TABLE visual_workshop_projects ADD COLUMN is_official BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE galgame_workshop_projects ADD COLUMN is_official BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE integration_tool_apis ADD COLUMN sensitive_result BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE integration_mcp_servers ADD COLUMN sensitive_result BOOLEAN NOT NULL DEFAULT 0;
CREATE TABLE runtime_admissions (
 id VARCHAR(36) PRIMARY KEY,
 user_id VARCHAR(36) REFERENCES users(id), workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id),
 platform_role VARCHAR(16) NOT NULL, realtime_voice BOOLEAN NOT NULL DEFAULT 0,
 weight INTEGER NOT NULL DEFAULT 1 CHECK(weight >= 1),
 task_kind VARCHAR(40), task_ids JSON NOT NULL DEFAULT '[]',
 released_at TIMESTAMP, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_runtime_admissions_active ON runtime_admissions(released_at, workspace_id, user_id);
"""
