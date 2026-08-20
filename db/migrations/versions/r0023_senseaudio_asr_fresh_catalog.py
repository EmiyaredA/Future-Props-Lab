MIGRATION_ID = "r0023_senseaudio_asr_fresh_catalog"

SQL = r"""
CREATE TEMP TABLE r0023_pristine_asr_catalogs AS
SELECT state.id AS workspace_id
FROM model_catalog_state AS state
WHERE state.revision = 1
  AND (
    SELECT COUNT(*)
    FROM model_providers AS provider
    WHERE provider.workspace_id = state.id
  ) = 1
  AND EXISTS (
    SELECT 1
    FROM model_providers AS provider
    WHERE provider.workspace_id = state.id
      AND provider.kind = 'senseaudio_asr'
      AND provider.api_key_ciphertext = ''
      AND provider.enabled = FALSE
  )
  AND (
    SELECT COUNT(*)
    FROM model_entries AS entry
    WHERE entry.workspace_id = state.id
  ) = 1
  AND EXISTS (
    SELECT 1
    FROM model_entries AS entry
    WHERE entry.workspace_id = state.id
      AND entry.slug = 'senseaudio-asr-pro-1.5-260319'
  );

DELETE FROM model_providers
WHERE kind = 'senseaudio_asr'
  AND workspace_id IN (
    SELECT workspace_id FROM r0023_pristine_asr_catalogs
  );

UPDATE model_catalog_state
SET revision = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE id IN (
  SELECT workspace_id FROM r0023_pristine_asr_catalogs
);

DROP TABLE r0023_pristine_asr_catalogs;
"""
