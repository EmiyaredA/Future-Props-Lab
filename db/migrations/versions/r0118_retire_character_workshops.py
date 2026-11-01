"""Retire the Live2D and desktop pet application schemas."""

MIGRATION_ID = "0118_retire_character_workshops"

SQL = """
DROP TABLE desktop_pet_chat_requests;
DROP TABLE desktop_pet_chat_messages;
DROP TABLE desktop_pet_chats;
DROP TABLE desktop_pet_projects;
DROP TABLE live2d_exports;
DROP TABLE live2d_cubism_attachments;
DROP TABLE live2d_assets;
DROP TABLE live2d_projects;
"""
