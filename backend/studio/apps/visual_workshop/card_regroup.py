"""Explicit, revision-checked regrouping without replacing card identities."""

from pydantic import Field, model_validator
from sqlalchemy import select, text

from studio.apps.visual_workshop.creative_assets import model_id
from studio.apps.visual_workshop.schemas.creative_workflow import Identifier, WorkflowModel
from studio.apps.visual_workshop.storage.creative_records import card_out
from studio.apps.visual_workshop.storage.models import VisualAssetCard
from studio.runtime.project_errors import ProjectResourceError


class CardRegroupIn(WorkflowModel):
    main_card_id: Identifier
    variant_ids: list[Identifier] = Field(min_length=1, max_length=499)
    expected_revisions: dict[Identifier, int] = Field(min_length=2, max_length=500)

    @model_validator(mode="after")
    def validate_members(self):
        members = {self.main_card_id, *self.variant_ids}
        if len(members) != len(self.variant_ids) + 1:
            raise ValueError("主卡与变体不能重复")
        if set(self.expected_revisions) != members or any(
            revision < 0 for revision in self.expected_revisions.values()
        ):
            raise ValueError("请提供全部卡片的当前版本")
        return self


async def regroup_cards(session, owner, body: CardRegroupIn):
    await session.rollback()
    await session.execute(text("BEGIN IMMEDIATE"))
    try:
        rows = list(
            await session.scalars(
                select(VisualAssetCard)
                .where(VisualAssetCard.owner_user_id == owner)
                .execution_options(populate_existing=True)
            )
        )
        known = {row.id: row for row in rows}
        if any(identity not in known for identity in body.expected_revisions):
            raise ProjectResourceError("设定卡不存在")
        for identity, revision in body.expected_revisions.items():
            if known[identity].revision != revision:
                raise ProjectResourceError("设定卡已在其他窗口更新", "visual_card_conflict", 409)
        main = known[body.main_card_id]
        parent = card_out(main)
        if parent.parent_id or parent.archived or not parent.adopted_asset_id:
            raise ProjectResourceError("请选择已有采用图的有效主卡", "visual_card_parent", 422)
        variants = set(body.variant_ids)
        if any(row.data.get("parent_id") in variants and row.id not in variants for row in rows):
            raise ProjectResourceError("请同时选择待归组卡的全部变体", "visual_card_parent", 422)
        for identity in body.variant_ids:
            row = known[identity]
            card = card_out(row)
            if card.kind != parent.kind or card.archived:
                raise ProjectResourceError("只能归组同类有效设定卡", "visual_card_parent", 422)
            if card.parent_id == parent.id and card.parent_asset_id == parent.adopted_asset_id:
                continue
            row.data = {
                **row.data,
                "parent_id": parent.id,
                "parent_asset_id": parent.adopted_asset_id,
            }
            retained = {
                card.adopted_asset_id,
                card.voice_asset_id,
                *card.candidate_asset_ids,
                model_id(card.model_asset_key) if card.model_asset_key else None,
            }
            row.media_projects = {
                **{key: value for key, value in row.media_projects.items() if key in retained},
                parent.adopted_asset_id: parent.media_projects[parent.adopted_asset_id],
            }
            row.revision += 1
        await session.flush()
        result = [card_out(known[identity]) for identity in [parent.id, *body.variant_ids]]
        await session.commit()
        return result
    except BaseException:
        await session.rollback()
        raise
