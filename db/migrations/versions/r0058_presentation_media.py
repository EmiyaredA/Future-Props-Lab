"""Materialize compatible style defaults without changing content or revisions."""

MIGRATION_ID = "0058_presentation_media"
SQL = """
UPDATE presentation_projects
SET document = json_set(document, '$.slides', json((
  SELECT json_group_array(json(updated_slide)) FROM (
    SELECT json_set(slide.value, '$.elements', json((
      SELECT json_group_array(json(updated_element)) FROM (
        SELECT json_insert(element.value,
          '$.opacity', 1, '$.flip_x', json('false'), '$.flip_y', json('false'),
          '$.vector_color', NULL, '$.image_border', json('false')) AS updated_element
        FROM json_each(slide.value, '$.elements') AS element
        ORDER BY CAST(element.key AS INTEGER)
      )
    ))) AS updated_slide
    FROM json_each(presentation_projects.document, '$.slides') AS slide
    ORDER BY CAST(slide.key AS INTEGER)
  )
)));
"""
