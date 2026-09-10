"""Materialize compatible style defaults without changing content or revisions."""

MIGRATION_ID = "0057_presentation_styles"
SQL = """
UPDATE presentation_projects
SET document = json_set(document, '$.slides', json((
  SELECT json_group_array(json(updated_slide)) FROM (
    SELECT json_set(slide.value, '$.elements', json((
      SELECT json_group_array(json(updated_element)) FROM (
        SELECT json_insert(element.value,
          '$.fill_opacity', 1, '$.stroke_dash', 'solid',
          '$.start_arrow', 'none', '$.end_arrow', 'none',
          '$.corner_radius', NULL) AS updated_element
        FROM json_each(slide.value, '$.elements') AS element
        ORDER BY CAST(element.key AS INTEGER)
      )
    ))) AS updated_slide
    FROM json_each(presentation_projects.document, '$.slides') AS slide
    ORDER BY CAST(slide.key AS INTEGER)
  )
)));
"""
