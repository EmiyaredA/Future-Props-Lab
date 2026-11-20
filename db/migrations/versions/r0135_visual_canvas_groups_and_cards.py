MIGRATION_ID = "0135_visual_canvas_groups_and_cards"

SQL = """
ALTER TABLE visual_canvas_documents ADD COLUMN groups JSON NOT NULL DEFAULT '[]';
ALTER TABLE visual_canvas_documents ADD COLUMN project_card_ids JSON NOT NULL DEFAULT '[]';
"""
