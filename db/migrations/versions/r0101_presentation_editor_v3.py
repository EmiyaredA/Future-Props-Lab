"""Upgrade native scenes without changing object identities or project revisions."""

MIGRATION_ID = "0101_presentation_editor_v3"
SQL = """
UPDATE presentation_projects
SET document = json_set(document, '$.version', 3, '$.slides', json((
  SELECT json_group_array(json(updated_slide)) FROM (
    SELECT json_set(slide.value, '$.elements', json((
      SELECT json_group_array(json(updated_element)) FROM (
        SELECT json_insert(element.value, '$.name', '', '$.hidden', json('false'))
          AS updated_element
        FROM json_each(slide.value, '$.elements') AS element
        ORDER BY CAST(element.key AS INTEGER)
      )
    ))) AS updated_slide
    FROM json_each(presentation_projects.document, '$.slides') AS slide
    ORDER BY CAST(slide.key AS INTEGER)
  )
)))
WHERE json_extract(document, '$.version') IN (1, 2);
"""
