MIGRATION_ID = "r0032_realtime_fresh_catalog"

SQL = r"""
DELETE FROM model_providers
WHERE id = 'f0000000-0000-4000-8000-000000000007'
  AND workspace_id = 'default'
  AND kind = 'senseaudio_realtime'
  AND EXISTS (
    SELECT 1
    FROM model_catalog_state AS state
    WHERE state.id = 'default'
      AND state.revision = 1
  )
  AND (SELECT COUNT(*) FROM model_providers WHERE workspace_id = 'default') = 1
  AND (SELECT COUNT(*) FROM model_entries WHERE workspace_id = 'default') = 1;

UPDATE model_catalog_state
SET revision = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'default'
  AND revision = 1
  AND NOT EXISTS (
    SELECT 1
    FROM model_providers
    WHERE workspace_id = 'default'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM model_entries
    WHERE workspace_id = 'default'
  );
"""
