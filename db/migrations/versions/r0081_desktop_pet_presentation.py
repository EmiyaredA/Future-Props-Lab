"""Remember each user's desktop pet conversation presentation."""

MIGRATION_ID = "r0081_desktop_pet_presentation"
SQL = """
ALTER TABLE desktop_pet_chats ADD COLUMN presentation_mode VARCHAR(16)
 NOT NULL DEFAULT 'dialogue' CHECK (presentation_mode IN ('bubble', 'dialogue'));
"""
