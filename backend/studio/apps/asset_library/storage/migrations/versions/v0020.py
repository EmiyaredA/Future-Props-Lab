"""Release retired conversation pins while retaining all underlying files."""

SQL = """
CREATE TEMP TABLE visual_dialogue_retirement_guard (
    unsettled INTEGER NOT NULL CHECK (unsettled = 0)
);
INSERT INTO visual_dialogue_retirement_guard
SELECT COUNT(*) FROM asset_reference_intents AS intent
JOIN asset_reference_sets AS ref ON ref.id = intent.reference_set_id
WHERE ref.service_id = 'visual' AND intent.state = 'prepared'
  AND (ref.resource_kind = 'conversation'
    OR json_array_length(intent.prepared_result, '$.visual_project_removal') > 0);
DROP TABLE visual_dialogue_retirement_guard;

DELETE FROM asset_import_receipts WHERE dataset = 'visual.conversation-pins';
DELETE FROM asset_reference_intents
WHERE reference_set_id IN (
    SELECT id FROM asset_reference_sets
    WHERE service_id = 'visual' AND resource_kind = 'conversation'
);
DELETE FROM asset_reference_sets
WHERE service_id = 'visual' AND resource_kind = 'conversation';
"""
