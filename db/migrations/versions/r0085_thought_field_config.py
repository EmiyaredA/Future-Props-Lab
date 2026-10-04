"""Display settings belong to fields; existing values and histories stay intact."""

MIGRATION_ID = "0085_thought_field_config"
SQL = """
ALTER TABLE thought_data_fields ADD COLUMN config JSON NOT NULL DEFAULT '{}';
"""
