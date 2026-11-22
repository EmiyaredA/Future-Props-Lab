"""Changing an adopted image retains its previously authorized image and scope."""

from uuid import uuid4

import pytest

from studio.apps.visual_workshop.creative_ports import CardEditContext, CreativeAsset
from studio.apps.visual_workshop.creative_rules import prepare_card
from studio.apps.visual_workshop.creative_workflow import CreativeWorkflow
from studio.apps.visual_workshop.schemas.creative_workflow import (
    CardData,
    CardOut,
    CardUpdate,
    ScriptOut,
)
from studio.apps.visual_workshop.storage.creative_records import SqlCreativeRecords
from studio.runtime.project_errors import ProjectResourceError
from website_test_support import SessionLocal


def update(card, **patch):
    return CardUpdate(
        **{
            **card.model_dump(exclude={"id", "revision", "media_projects", "source_project_id"}),
            "expected_revision": card.revision,
            **patch,
        }
    )


async def fixture(session, *, kind="character", count=1):
    owner = str(uuid4())
    ids = [str(uuid4()) for _ in range(count + 1)]

    async def inspect(_project, requested):
        return {
            identity: CreativeAsset("image", "image/png", None)
            for identity in requested
            if identity in ids
        }

    workflow = CreativeWorkflow(SqlCreativeRecords(session, owner), inspect)
    card = await workflow.save_card(
        None,
        CardData(kind=kind, title="设定", adopted_asset_id=ids[0], candidate_asset_ids=ids[1:]),
    )
    return workflow, card, ids, owner


@pytest.mark.parametrize("kind", ["character", "scene", "prop"])
async def test_old_client_selection_retains_old_adopted_image_and_round_trips(kind):
    async with SessionLocal() as session:
        workflow, before, ids, _ = await fixture(session, kind=kind)
        saved = await workflow.save_card(None, update(before, adopted_asset_id=ids[1]), before.id)
        assert saved.candidate_asset_ids == ids
        assert saved.adopted_asset_id == ids[1]
        assert saved.media_projects == before.media_projects
        assert await workflow.card(None, saved.id) == saved
        restored = await workflow.save_card(None, update(saved, adopted_asset_id=ids[0]), saved.id)
        assert restored.candidate_asset_ids == ids
        assert restored.adopted_asset_id == ids[0]
        assert restored.media_projects == before.media_projects


async def test_clearing_adoption_keeps_the_image_and_deduplicates_without_reordering():
    async with SessionLocal() as session:
        workflow, before, ids, _ = await fixture(session)
        cleared = await workflow.save_card(
            None,
            update(before, adopted_asset_id=None, candidate_asset_ids=[ids[1], ids[1]]),
            before.id,
        )
        assert cleared.candidate_asset_ids == ids
        assert cleared.adopted_asset_id is None
        assert cleared.media_projects == before.media_projects


async def test_capacity_failure_preserves_the_original_card_and_revision():
    async with SessionLocal() as session:
        workflow, before, ids, _ = await fixture(session, count=80)
        with pytest.raises(ProjectResourceError) as failure:
            await workflow.save_card(None, update(before, adopted_asset_id=ids[1]), before.id)
        assert failure.value.code == "visual_card_candidate_limit"
        assert await workflow.card(None, before.id) == before


async def test_bad_image_stale_revision_and_other_account_cannot_lose_the_original():
    async with SessionLocal() as session:
        workflow, before, ids, _ = await fixture(session)
        with pytest.raises(ProjectResourceError) as invalid:
            await workflow.save_card(None, update(before, adopted_asset_id=str(uuid4())), before.id)
        assert invalid.value.code == "visual_asset_scope"
        assert await workflow.card(None, before.id) == before
        saved = await workflow.save_card(None, update(before, adopted_asset_id=ids[1]), before.id)
        with pytest.raises(ProjectResourceError) as conflict:
            await workflow.save_card(None, update(before, adopted_asset_id=ids[0]), before.id)
        assert conflict.value.status == 409
        with pytest.raises(ProjectResourceError):
            await CreativeWorkflow(SqlCreativeRecords(session, str(uuid4()))).save_card(
                None, update(saved, adopted_asset_id=ids[0]), before.id
            )
        assert await workflow.card(None, before.id) == saved


def test_retained_project_image_keeps_its_existing_project_scope():
    old, new, project = [str(uuid4()) for _ in range(3)]
    before = CardOut(
        id=str(uuid4()),
        revision=0,
        kind="character",
        title="设定",
        adopted_asset_id=old,
        candidate_asset_ids=[new],
        media_projects={old: project, new: None},
    )
    prepared = prepare_card(
        None,
        update(before, adopted_asset_id=new),
        {new},
        {new},
        set(),
        set(),
        {new: CreativeAsset("image", "image/png", None)},
        CardEditContext(before, None, ScriptOut(revision=0)),
    )
    assert prepared.media_projects == {old: project, new: None}
    assert prepared.data.candidate_asset_ids == [old, new]
