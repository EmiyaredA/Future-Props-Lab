"""Default legacy ports to side midpoints, preserving route data and revisions."""

MIGRATION_ID = "0100_presentation_connection_offsets"
SQL = """
UPDATE presentation_projects
SET document = json_set(document, '$.slides', json((
  SELECT json_group_array(json(updated_slide)) FROM (
    SELECT json_set(slide.value, '$.connections', json((
      SELECT json_group_array(json(updated_edge)) FROM (
        SELECT json_insert(edge.value, '$.source_offset', 0.5, '$.target_offset', 0.5)
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
  WHERE json_type(edge.value, '$.source_offset') IS NULL
     OR json_type(edge.value, '$.target_offset') IS NULL
);
"""
