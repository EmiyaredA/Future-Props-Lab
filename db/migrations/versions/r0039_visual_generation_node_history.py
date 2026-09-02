# ruff: noqa: E501

MIGRATION_ID = "r0039_visual_generation_node_history"

SQL = r"""
ALTER TABLE visual_generation_tasks ADD COLUMN canvas_node_id VARCHAR(64);

UPDATE visual_generation_tasks
SET canvas_node_id = (
  SELECT json_extract(node.value, '$.id')
  FROM visual_canvas_documents AS canvas,
       json_each(canvas.nodes) AS node
  WHERE canvas.project_id = visual_generation_tasks.project_id
    AND json_extract(node.value, '$.generation_task_id') = visual_generation_tasks.id
  LIMIT 1
)
WHERE canvas_node_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM visual_canvas_documents AS canvas,
         json_each(canvas.nodes) AS node
    WHERE canvas.project_id = visual_generation_tasks.project_id
      AND json_extract(node.value, '$.generation_task_id') = visual_generation_tasks.id
  );

CREATE INDEX ix_visual_generation_tasks_project_canvas_node_created
  ON visual_generation_tasks(project_id, canvas_node_id, created_at DESC);
"""
