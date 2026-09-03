MIGRATION_ID = "r0040_video_editor_mixed_tracks"

SQL = r"""
UPDATE video_editor_timelines
SET document = json_set(
  document,
  '$.tracks',
  json_insert(
    json_extract(document, '$.tracks'),
    '$[#]',
    json_object(
      'id', 'mixed-1',
      'kind', 'mixed',
      'name', '混合 1',
      'order', json_array_length(json_extract(document, '$.tracks')),
      'locked', 0,
      'hidden', 0,
      'muted', 0,
      'clips', json('[]')
    )
  )
)
WHERE json_type(document, '$.tracks') = 'array'
  AND NOT EXISTS (
    SELECT 1
    FROM json_each(document, '$.tracks')
    WHERE json_extract(json_each.value, '$.kind') = 'mixed'
  );
"""
