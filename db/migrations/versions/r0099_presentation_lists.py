"""Materialize paragraph numbering defaults while preserving legacy bullets and revisions."""

MIGRATION_ID = "0099_presentation_lists"
SQL = """
UPDATE presentation_projects
SET document = json_set(document, '$.slides', json((
  SELECT json_group_array(json(updated_slide)) FROM (
    SELECT json_set(slide.value, '$.elements', json((
      SELECT json_group_array(json(updated_element)) FROM (
        SELECT json_set(element.value, '$.paragraphs', json((
          SELECT json_group_array(json(updated_paragraph)) FROM (
            SELECT json_insert(paragraph.value, '$.numbered', json('false')) AS updated_paragraph
            FROM json_each(element.value, '$.paragraphs') AS paragraph
            ORDER BY CAST(paragraph.key AS INTEGER)
          )
        ))) AS updated_element
        FROM json_each(slide.value, '$.elements') AS element
        ORDER BY CAST(element.key AS INTEGER)
      )
    ))) AS updated_slide
    FROM json_each(presentation_projects.document, '$.slides') AS slide
    ORDER BY CAST(slide.key AS INTEGER)
  )
)))
WHERE EXISTS (
  SELECT 1 FROM json_each(presentation_projects.document, '$.slides') AS slide,
    json_each(slide.value, '$.elements') AS element,
    json_each(element.value, '$.paragraphs') AS paragraph
  WHERE json_type(paragraph.value, '$.numbered') IS NULL
);
"""
