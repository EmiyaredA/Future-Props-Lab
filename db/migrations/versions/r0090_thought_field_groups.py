"""Field groups belong to the table; existing tables start with none."""

MIGRATION_ID = "0090_thought_field_groups"
SQL = """
ALTER TABLE thought_data_tables ADD COLUMN groups JSON NOT NULL DEFAULT '[]';
"""
