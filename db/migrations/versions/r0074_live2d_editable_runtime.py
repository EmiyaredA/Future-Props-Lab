"""Advance saved Live2D documents to the editable runtime shape."""

MIGRATION_ID = "r0074_live2d_editable_runtime"
SQL = """
UPDATE live2d_projects
SET document = json_set(
    document,
    '$.schemaVersion', 4,
    '$.logicalParts', json('[]'),
    '$.poseGroups', json('[]'),
    '$.physicsGroups', json('[]'),
    '$.parameterPairs', json('[]')
)
WHERE CAST(json_extract(document, '$.schemaVersion') AS INTEGER) = 3;
"""
