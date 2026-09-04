MIGRATION_ID = "r0042_image_compositions"

SQL = r"""
ALTER TABLE visual_generation_batches
  ADD COLUMN batch_kind VARCHAR(16) NOT NULL DEFAULT 'generation'
  CHECK (batch_kind IN ('generation', 'composition'));
ALTER TABLE visual_generation_batches
  ADD COLUMN source_items JSON NOT NULL DEFAULT '[]';
"""
