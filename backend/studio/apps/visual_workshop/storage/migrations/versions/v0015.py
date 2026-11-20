SQL = """
ALTER TABLE visual_canvas_documents ADD COLUMN groups JSON NOT NULL DEFAULT '[]';
ALTER TABLE visual_canvas_documents ADD COLUMN project_card_ids JSON NOT NULL DEFAULT '[]';
"""
