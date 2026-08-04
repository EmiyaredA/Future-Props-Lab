MIGRATION_ID = "r0013_visual_assistant_generation_models"

SQL = r"""
ALTER TABLE visual_assistant_conversations
  ADD COLUMN image_model_id VARCHAR(36)
    REFERENCES model_entries(id) ON DELETE SET NULL;
ALTER TABLE visual_assistant_conversations
  ADD COLUMN video_model_id VARCHAR(36)
    REFERENCES model_entries(id) ON DELETE SET NULL;

CREATE INDEX ix_visual_assistant_conversations_image_model
  ON visual_assistant_conversations(image_model_id);
CREATE INDEX ix_visual_assistant_conversations_video_model
  ON visual_assistant_conversations(video_model_id);
"""
