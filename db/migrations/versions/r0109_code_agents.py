"""Preserve Pi history while binding new conversations to external runtimes."""

MIGRATION_ID = "0109_code_agents"
SQL = """
ALTER TABLE amadeus_conversations ADD COLUMN executor_kind VARCHAR(24) NOT NULL DEFAULT 'legacy-pi';
ALTER TABLE amadeus_conversations ADD COLUMN agent_id VARCHAR(24);
ALTER TABLE amadeus_runs ADD COLUMN agent_id VARCHAR(24);
ALTER TABLE amadeus_runs ADD COLUMN agent_model VARCHAR(160) NOT NULL DEFAULT '';
ALTER TABLE amadeus_runs ADD COLUMN execution_config JSON NOT NULL DEFAULT '{}';
"""
