MIGRATION_ID = "r0037_media_workshop_upgrade"

SQL = r"""
ALTER TABLE visual_canvas_documents
  ADD COLUMN edges JSON NOT NULL DEFAULT '[]';
"""
