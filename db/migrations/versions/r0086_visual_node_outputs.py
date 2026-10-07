"""Node history is derived only from explicitly linked legacy generation records."""

MIGRATION_ID = "r0086_visual_node_outputs"
SQL = """
ALTER TABLE visual_canvas_documents ADD COLUMN categories JSON NOT NULL DEFAULT '[]';
CREATE TABLE visual_node_outputs (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL REFERENCES visual_workshop_projects(id) ON DELETE CASCADE,
    node_id VARCHAR(64) NOT NULL,
    version INTEGER NOT NULL,
    kind VARCHAR(16) NOT NULL,
    asset_id VARCHAR(36) REFERENCES visual_assets(id) ON DELETE RESTRICT,
    text TEXT,
    source VARCHAR(16) NOT NULL,
    source_key VARCHAR(160) NOT NULL,
    generation_task_id VARCHAR(36),
    input_snapshot JSON NOT NULL DEFAULT '[]',
    is_final BOOLEAN NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL,
    UNIQUE(project_id, node_id, version),
    UNIQUE(project_id, source_key)
);
CREATE INDEX ix_visual_node_outputs_project_id ON visual_node_outputs(project_id);
CREATE INDEX ix_visual_node_outputs_node_id ON visual_node_outputs(node_id);
WITH records AS (
    SELECT c.project_id, json_extract(n.value, '$.id') node_id,
        json_extract(n.value, '$.kind') kind, t.result_asset_id asset_id,
        NULL text, 'generated' source, 'task:' || t.id source_key,
        t.id task_id, coalesce(t.completed_at, t.created_at) created_at
    FROM visual_canvas_documents c, json_each(c.nodes) n
    JOIN visual_generation_tasks t ON t.project_id=c.project_id
        AND t.canvas_node_id=json_extract(n.value, '$.id')
    JOIN visual_assets a ON a.id=t.result_asset_id
    WHERE t.status='completed'
    UNION ALL
    SELECT c.project_id, json_extract(n.value, '$.id'), json_extract(n.value, '$.kind'),
        json_extract(n.value, '$.asset_id'),
        CASE WHEN json_extract(n.value, '$.kind')='text' THEN json_extract(n.value, '$.text') END,
        'legacy', 'legacy:' || json_extract(n.value, '$.id'), NULL, c.updated_at
    FROM visual_canvas_documents c, json_each(c.nodes) n
    WHERE (json_extract(n.value, '$.kind')='text' AND length(json_extract(n.value, '$.text'))>0)
       OR (EXISTS(SELECT 1 FROM visual_assets a WHERE a.id=json_extract(n.value, '$.asset_id'))
           AND NOT EXISTS(SELECT 1 FROM visual_generation_tasks t WHERE t.project_id=c.project_id
               AND t.canvas_node_id=json_extract(n.value, '$.id') AND t.status='completed'
               AND t.result_asset_id=json_extract(n.value, '$.asset_id')))
)
INSERT INTO visual_node_outputs
SELECT lower(hex(randomblob(16))), project_id, node_id,
    row_number() OVER(PARTITION BY project_id,node_id ORDER BY created_at,source_key),
    kind, asset_id, text, source, source_key, task_id, '[]', 0, created_at FROM records;
UPDATE visual_node_outputs SET is_final=1 WHERE id IN (
    SELECT (SELECT o.id FROM visual_node_outputs o
        WHERE o.project_id=c.project_id AND o.node_id=json_extract(n.value,'$.id')
        ORDER BY CASE WHEN o.asset_id=json_extract(n.value,'$.asset_id') THEN 0 ELSE 1 END,
                 o.version DESC LIMIT 1)
    FROM visual_canvas_documents c,json_each(c.nodes) n
);
UPDATE visual_canvas_documents SET nodes=coalesce((
    SELECT json_group_array(json(CASE WHEN o.id IS NULL THEN n.value ELSE
        CASE WHEN o.kind='text' THEN json_set(n.value,'$.final_output_id',o.id,
            '$.final_version',o.version)
        ELSE json_set(n.value,'$.final_output_id',o.id,
            '$.final_version',o.version,'$.asset_id',o.asset_id) END
        END))
    FROM json_each(visual_canvas_documents.nodes) n
    LEFT JOIN visual_node_outputs o ON o.project_id=visual_canvas_documents.project_id
        AND o.node_id=json_extract(n.value,'$.id') AND o.is_final=1
), '[]');
"""
