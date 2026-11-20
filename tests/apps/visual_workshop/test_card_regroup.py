"""Grouping preserves card identities and rejects incomplete or conflicting changes."""

from uuid import uuid4

import httpx
import pytest
from pydantic import ValidationError

from studio.apps.visual_workshop.card_regroup import CardRegroupIn, regroup_cards
from studio.apps.visual_workshop.creative_ports import CreativeAsset
from studio.apps.visual_workshop.creative_workflow import CreativeWorkflow
from studio.apps.visual_workshop.schemas.creative_workflow import CardData
from studio.apps.visual_workshop.storage.creative_records import SqlCreativeRecords
from studio.runtime.project_errors import ProjectResourceError
from website_test_support import SessionLocal, app


async def cards(session):
    owner = str(uuid4())
    image = str(uuid4())

    async def inspect(_project, ids):
        return {identity: CreativeAsset("image", "image/png", None) for identity in ids}

    workflow = CreativeWorkflow(SqlCreativeRecords(session, owner), inspect)
    main = await workflow.save_card(
        None, CardData(kind="character", title="林夏", adopted_asset_id=image)
    )
    other = await workflow.save_card(
        None, CardData(kind="character", title="林夏·雨衣", adopted_asset_id=str(uuid4()))
    )
    return owner, workflow, main, other


def grouping(main, *variants):
    return CardRegroupIn(
        main_card_id=main.id,
        variant_ids=[card.id for card in variants],
        expected_revisions={card.id: card.revision for card in (main, *variants)},
    )


async def test_regroup_preserves_media_identity_and_is_idempotent():
    async with SessionLocal() as session:
        owner, workflow, main, variant = await cards(session)
        saved = await regroup_cards(session, owner, grouping(main, variant))
        assert saved[0] == main
        assert saved[1].id == variant.id
        assert saved[1].adopted_asset_id == variant.adopted_asset_id
        assert saved[1].parent_asset_id == main.adopted_asset_id
        assert saved[1].parent_id == main.id
        assert saved[1].revision == 1
        assert saved[1].media_projects == {
            **variant.media_projects,
            **main.media_projects,
        }
        assert await regroup_cards(session, owner, grouping(*saved)) == saved
        with pytest.raises(ProjectResourceError) as conflict:
            await regroup_cards(session, owner, grouping(main, variant))
        assert conflict.value.status == 409
        assert {card.id: card for card in await workflow.cards()}[variant.id] == saved[1]


async def test_regroup_rejects_cycles_incomplete_children_and_cross_owner():
    async with SessionLocal() as session:
        owner, workflow, main, variant = await cards(session)
        child = await workflow.save_card(
            None,
            CardData(
                kind="character",
                title="雨衣·兜帽",
                parent_id=variant.id,
                parent_asset_id=variant.adopted_asset_id,
            ),
        )
        for principal, body in [
            (str(uuid4()), grouping(main, variant, child)),
            (owner, grouping(main, variant)),
            (owner, grouping(child, variant)),
        ]:
            with pytest.raises(ProjectResourceError):
                await regroup_cards(session, principal, body)
        unchanged = {card.id: card for card in await workflow.cards()}
        assert unchanged[variant.id].parent_id is None
        assert unchanged[child.id] == child
        saved = await regroup_cards(session, owner, grouping(main, variant, child))
        assert all(card.parent_id == main.id for card in saved[1:])


async def test_regroup_rolls_back_all_on_type_mismatch():
    async with SessionLocal() as session:
        owner, workflow, main, variant = await cards(session)
        scene = await workflow.save_card(None, CardData(kind="scene", title="港口"))
        with pytest.raises(ProjectResourceError):
            await regroup_cards(session, owner, grouping(main, variant, scene))
        current = {card.id: card for card in await workflow.cards()}
        assert current[variant.id] == variant
        assert current[scene.id] == scene


def test_regroup_requires_complete_nonnegative_revisions():
    main, variant = str(uuid4()), str(uuid4())
    for variants, revisions in [
        ([main], {main: 0, variant: 0}),
        ([variant, variant], {main: 0, variant: 0}),
        ([variant], {main: 0}),
        ([variant], {main: -1, variant: 0}),
    ]:
        with pytest.raises(ValidationError):
            CardRegroupIn(main_card_id=main, variant_ids=variants, expected_revisions=revisions)


async def test_regroup_public_route_is_registered():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        response = await c.post("/v1/visual-workshop/asset-cards/regroup", json={})
        assert response.status_code == 422
