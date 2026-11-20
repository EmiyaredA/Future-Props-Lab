MIGRATION_ID = "0134_visual_account_asset_cards"

SQL = """
CREATE TABLE visual_asset_cards_owned (
    id VARCHAR(36) PRIMARY KEY NOT NULL,
    owner_user_id VARCHAR(36) NOT NULL,
    project_id VARCHAR(36),
    revision INTEGER NOT NULL,
    data JSON NOT NULL,
    media_projects JSON NOT NULL
);
INSERT INTO visual_asset_cards_owned (id, owner_user_id, project_id, revision, data, media_projects)
SELECT card.id, project.owner_user_id, card.project_id, card.revision, card.data,
       COALESCE((
           SELECT json_group_object(asset_id, card.project_id)
           FROM (
               SELECT json_extract(card.data, '$.adopted_asset_id') AS asset_id
               UNION SELECT json_extract(card.data, '$.parent_asset_id')
               UNION SELECT value FROM json_each(card.data, '$.candidate_asset_ids')
               UNION SELECT substr(json_extract(card.data, '$.model_asset_key'), 23, 36)
           ) WHERE asset_id IS NOT NULL
       ), '{}')
FROM visual_asset_cards AS card
JOIN visual_workshop_projects AS project ON project.id = card.project_id;
DROP TABLE visual_asset_cards;
ALTER TABLE visual_asset_cards_owned RENAME TO visual_asset_cards;
CREATE INDEX ix_visual_asset_cards_owner_user_id ON visual_asset_cards(owner_user_id);
"""
