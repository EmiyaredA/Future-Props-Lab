MIGRATION_ID = "r0069_retire_unsupported_senseaudio_models"

SQL = r"""
CREATE TEMP TABLE r0069_slug_map (
  old_slug TEXT NOT NULL PRIMARY KEY,
  new_slug TEXT NOT NULL
);

INSERT INTO r0069_slug_map (old_slug, new_slug) VALUES
  ('sensenova-6.7-flash-lite', 'sensenova-6.8-flash-lite'),
  ('deepseek-v4-flash', 'deepseek-v4.1-flash'),
  ('deepseek-v4-pro', 'deepseek-v4.1-flash'),
  ('qwen3.6-27b', 'qwen3.8-27b'),
  ('glm-5.1', 'glm-5.3-flash'),
  ('senseaudio-image-1.0-260319', 'senseaudio-image-2.0-260319');

CREATE TEMP TABLE r0069_id_map AS
SELECT
  old_entry.id AS old_id,
  new_entry.id AS new_id,
  old_entry.workspace_id AS workspace_id
FROM model_entries AS old_entry
JOIN r0069_slug_map AS slug_map
  ON slug_map.old_slug = old_entry.slug
LEFT JOIN model_entries AS new_entry
  ON new_entry.workspace_id = old_entry.workspace_id
 AND new_entry.slug = slug_map.new_slug;

UPDATE platform_settings
SET payload = COALESCE(
  (
    SELECT json_group_object(
      j.key,
      COALESCE(mapped.new_id, j.value)
    )
    FROM json_each(platform_settings.payload) AS j
    LEFT JOIN r0069_id_map AS mapped
      ON mapped.old_id = j.value
     AND mapped.workspace_id = substr(
       platform_settings.id,
       length('workspace_defaults:') + 1
     )
    WHERE mapped.old_id IS NULL OR mapped.new_id IS NOT NULL
  ),
  '{}'
),
revision = revision + 1,
updated_at = CURRENT_TIMESTAMP
WHERE id LIKE 'workspace_defaults:%'
  AND EXISTS (
    SELECT 1
    FROM json_each(platform_settings.payload) AS j
    JOIN r0069_id_map AS mapped
      ON mapped.old_id = j.value
     AND mapped.workspace_id = substr(
       platform_settings.id,
       length('workspace_defaults:') + 1
     )
  );

DELETE FROM model_entries
WHERE slug IN (SELECT old_slug FROM r0069_slug_map);

UPDATE model_catalog_state
SET revision = revision + 1,
    updated_at = CURRENT_TIMESTAMP
WHERE id IN (
  SELECT DISTINCT workspace_id FROM r0069_id_map
);

DROP TABLE r0069_id_map;
DROP TABLE r0069_slug_map;
"""
