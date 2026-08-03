MIGRATION_ID = "r0009_visual_canvas_documents"

SQL = r"""
CREATE TABLE visual_canvas_documents (
  project_id VARCHAR(36) PRIMARY KEY
    REFERENCES visual_workshop_projects(id) ON DELETE CASCADE,
  nodes JSON NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO visual_canvas_documents (project_id, nodes, revision)
SELECT id, '[]', 0 FROM visual_workshop_projects;
"""
