MIGRATION_ID = "r0014_visual_assistant_content_parts"

SQL = r"""
ALTER TABLE visual_assistant_messages
  ADD COLUMN content_parts JSON NOT NULL DEFAULT '[]';
"""
