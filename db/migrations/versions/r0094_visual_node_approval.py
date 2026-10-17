"""Initialize the independent manual approval marker on existing visual nodes."""

MIGRATION_ID = "r0094_visual_node_approval"
SQL = """
UPDATE visual_canvas_documents SET nodes = (
    SELECT json_group_array(json(CASE
        WHEN json_type(n.value, '$.approved') IS NULL
        THEN json_set(n.value, '$.approved', json('false'))
        ELSE n.value END))
    FROM json_each(visual_canvas_documents.nodes) n
)
WHERE EXISTS (
    SELECT 1 FROM json_each(visual_canvas_documents.nodes) n
    WHERE json_type(n.value, '$.approved') IS NULL
);
"""
