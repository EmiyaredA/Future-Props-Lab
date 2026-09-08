MIGRATION_ID = "r0043_video_editor_playback_rate"

# Normalize existing timeline JSON; immutable task snapshots retain the legacy
# default of 1x when loaded by the timeline schema.
SQL = r"""
UPDATE video_editor_timelines
SET document = json_set(document, '$.tracks', json((
  SELECT json_group_array(json_set(track.value, '$.clips', json((
    SELECT json_group_array(json_set(
      clip.value, '$.playbackRate',
      coalesce(json_extract(clip.value, '$.playbackRate'), 1.0)
    ))
    FROM json_each(track.value, '$.clips') AS clip
  ))))
  FROM json_each(document, '$.tracks') AS track
)))
WHERE json_type(document, '$.tracks') = 'array';
"""
