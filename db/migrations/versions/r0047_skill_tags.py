"""Keep editable Skill tags separate from immutable content versions."""

MIGRATION_ID = "0047_skill_tags"

SQL = """
ALTER TABLE integration_skills ADD COLUMN tags JSON NOT NULL DEFAULT '[]';
"""
