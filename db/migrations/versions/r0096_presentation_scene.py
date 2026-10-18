"""Materialize native scene v2 without changing existing content or revisions."""

MIGRATION_ID = "0096_presentation_scene"
SQL = """
UPDATE presentation_projects
SET document = json_set(document, '$.version', 2, '$.slides', json((
  SELECT json_group_array(json(updated_slide)) FROM (
    SELECT json_insert(slide.value,
      '$.groups', json('[]'), '$.connections', json('[]'),
      '$.infographics', json('[]'), '$.reference', NULL) AS updated_slide
    FROM json_each(presentation_projects.document, '$.slides') AS slide
    ORDER BY CAST(slide.key AS INTEGER)
  )
)))
WHERE json_extract(document, '$.version') = 1;
"""
