"""Add an optional archived image to each slide, preserving content and revisions."""

MIGRATION_ID = "0097_presentation_image_version"
SQL = """
UPDATE presentation_projects
SET document = json_set(document, '$.slides', json((
  SELECT json_group_array(json(updated_slide)) FROM (
    SELECT json_insert(slide.value, '$.image_asset_id', NULL) AS updated_slide
    FROM json_each(presentation_projects.document, '$.slides') AS slide
    ORDER BY CAST(slide.key AS INTEGER)
  )
)))
WHERE EXISTS (
  SELECT 1 FROM json_each(presentation_projects.document, '$.slides') AS slide
  WHERE json_type(slide.value, '$.image_asset_id') IS NULL
);
"""
