"""Normalize optional free endpoints without moving existing bound connections."""

MIGRATION_ID = "0104_presentation_free_connections"
SQL = """
UPDATE presentation_projects
SET document = json_set(document, '$.slides', json((
  SELECT json_group_array(json(updated_slide)) FROM (
    SELECT json_set(slide.value, '$.connections', json((
      SELECT json_group_array(json(updated_edge)) FROM (
        SELECT json_insert(edge.value, '$.source_point', NULL, '$.target_point', NULL)
          AS updated_edge
        FROM json_each(slide.value, '$.connections') AS edge
        ORDER BY CAST(edge.key AS INTEGER)
      )
    ))) AS updated_slide
    FROM json_each(presentation_projects.document, '$.slides') AS slide
    ORDER BY CAST(slide.key AS INTEGER)
  )
)))
WHERE EXISTS (
  SELECT 1 FROM json_each(presentation_projects.document, '$.slides') AS slide,
    json_each(slide.value, '$.connections') AS edge
  WHERE json_type(edge.value, '$.source_point') IS NULL
     OR json_type(edge.value, '$.target_point') IS NULL
);
"""
