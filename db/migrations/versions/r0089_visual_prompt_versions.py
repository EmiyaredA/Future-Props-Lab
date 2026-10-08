"""Preserve existing media prompts as the first editable variant."""

MIGRATION_ID = "r0089_visual_prompt_versions"
SQL = """
UPDATE visual_canvas_documents SET nodes = (
    SELECT json_group_array(json(CASE
        WHEN json_extract(n.value, '$.kind') IN ('image', 'video', 'audio')
          AND json_type(n.value, '$.generation_draft') = 'object'
          AND json_type(n.value, '$.generation_draft.prompt_versions') IS NULL
        THEN json_set(n.value,
            '$.generation_draft.prompt_versions', json_array(json_object(
                'id', 'v1', 'name', 'v1',
                'prompt', coalesce(json_extract(n.value, '$.generation_draft.prompt'), '')
            )), '$.generation_draft.active_prompt_version_id', 'v1')
        ELSE n.value END))
    FROM json_each(visual_canvas_documents.nodes) n
)
WHERE EXISTS (
    SELECT 1 FROM json_each(visual_canvas_documents.nodes) n
    WHERE json_extract(n.value, '$.kind') IN ('image', 'video', 'audio')
      AND json_type(n.value, '$.generation_draft') = 'object'
      AND json_type(n.value, '$.generation_draft.prompt_versions') IS NULL
);
"""
