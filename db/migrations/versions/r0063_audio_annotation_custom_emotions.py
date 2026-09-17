MIGRATION_ID = "r0063_audio_annotation_custom_emotions"

SQL = r"""
ALTER TABLE audio_annotation_documents
  ADD COLUMN custom_emotions JSON NOT NULL DEFAULT '[]';
"""
