"""Cross-service transaction outcomes retain committed and prospective files independently."""

from datetime import datetime

import pytest
from sqlalchemy import select

from studio.apps.asset_library.references.reference_changes import ReferenceChanges
from studio.apps.asset_library.references.references import protect_references
from studio.apps.asset_library.storage.service_models import (
    MODELS,
    AssetReferencePin,
    PreparedAssetPin,
    ReferenceIntent,
)
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.asset_library.references import PrepareReferenceChange
from studio.runtime.database.sessions import Database
from tests.apps.asset_library.test_asset_reference_retention import assets as assets
from tests.apps.asset_library.test_asset_reference_retention import update


def change(request, revision=5, files=("two",)):
    return PrepareReferenceChange(
        request_id=request,
        resource_kind="note",
        resource_id="owned-note",
        expected_resource_revision=revision,
        asset_ids=list(files),
    )


async def stage(database, value):
    return await ReferenceChanges(database).prepare(owner="alpha", service="thought", change=value)


async def commit(database, prepared, revision, **options):
    return await ReferenceChanges(database).commit(
        owner="alpha",
        service="thought",
        intent_id=prepared["intent_id"],
        resource_revision=revision,
        **options,
    )


async def pins(database):
    async with database.sessions() as session:
        session.info["owner_user_id"] = "alpha"
        return (
            set((await session.scalars(select(AssetReferencePin.asset_id))).all()),
            set((await session.scalars(select(PreparedAssetPin.asset_id))).all()),
        )


async def test_two_preparations_do_not_replace_each_others_prospective_files(assets):
    database, references = assets
    await references.replace(owner="alpha", service="thought", update=update())
    first = await stage(database, change("a"))
    second = await stage(database, change("b", files=("three",)))
    assert await pins(database) == ({"one"}, {"two", "three"})
    async with database.sessions() as session:
        session.info["owner_user_id"] = "alpha"
        for asset_id in ("one", "two", "three"):
            with pytest.raises(AssetError):
                await protect_references(session, [asset_id])
    await commit(database, first, 6)
    assert await pins(database) == ({"two"}, set())
    state = await ReferenceChanges(database).status(
        owner="alpha", service="thought", intent_id=second["intent_id"]
    )
    assert state["state"] == "superseded"
    with pytest.raises(AssetError) as impossible_source_commit:
        await commit(database, second, 6)
    assert impossible_source_commit.value.code == "source_revision_conflict"


async def test_delayed_first_confirmation_keeps_a_newer_preparation(assets):
    database, references = assets
    await references.replace(owner="alpha", service="thought", update=update())
    first = await stage(database, change("a"))
    # A's source CAS already saved revision 6; its Assets confirmation is delayed.
    second = await stage(database, change("b", 6, ("three",)))
    accepted = await commit(database, first, 6)
    assert await pins(database) == ({"two"}, {"three"})
    await commit(database, second, 7)
    assert await pins(database) == ({"three"}, set())
    assert await commit(database, first, 6) == accepted
    assert await pins(database) == ({"three"}, set())


async def test_out_of_order_source_confirmations_do_not_restore_old_files(assets):
    database, references = assets
    await references.replace(owner="alpha", service="thought", update=update())
    first = await stage(database, change("a"))
    second = await stage(database, change("b", 6, ("three",)))
    latest = await commit(database, second, 7)
    earlier = await commit(database, first, 6)
    assert earlier["state"] == "superseded"
    with pytest.raises(AssetError) as cannot_rewrite_known_outcome:
        await ReferenceChanges(database).abort(
            owner="alpha", service="thought", intent_id=first["intent_id"]
        )
    assert cannot_rewrite_known_outcome.value.code == "reference_intent_committed"
    assert await pins(database) == ({"three"}, set())
    assert await commit(database, second, 7) == latest
    with pytest.raises(AssetError):
        await ReferenceChanges(database).abort(
            owner="alpha", service="thought", intent_id=second["intent_id"]
        )


async def test_unknown_source_outcome_survives_restart_until_proven_rollback(assets):
    database, references = assets
    await references.replace(owner="alpha", service="thought", update=update())
    value = change("unknown")
    prepared = await stage(database, value)
    async with database.sessions() as session:
        session.info["owner_user_id"] = "alpha"
        intent = await session.get(ReferenceIntent, prepared["intent_id"])
        intent.created_at = intent.updated_at = datetime(1990, 1, 1)
        await session.commit()
    reopened = Database("assets", database.root, models=MODELS)
    try:
        assert await stage(reopened, value) == prepared
        assert await pins(reopened) == ({"one"}, {"two"})
        outcome = await ReferenceChanges(reopened).abort(
            owner="alpha", service="thought", intent_id=prepared["intent_id"]
        )
        assert outcome["state"] == "aborted"
        assert await pins(reopened) == ({"one"}, set())
        assert (
            await ReferenceChanges(reopened).abort(
                owner="alpha", service="thought", intent_id=prepared["intent_id"]
            )
            == outcome
        )
        with pytest.raises(AssetError) as rejected:
            await commit(reopened, prepared, 6)
        assert rejected.value.code == "reference_intent_aborted"
    finally:
        await reopened.close()


async def test_new_resources_and_permanent_deletion_keep_immutable_outcomes(assets):
    database, _references = assets
    changes = ReferenceChanges(database)
    with pytest.raises(AssetError) as absent_projection:
        await stage(database, change("unverified-existing", 0))
    assert absent_projection.value.code == "reference_projection_required"
    prepared = await stage(database, change("create", -1))
    await commit(database, prepared, 0)
    deletion = await stage(database, change("delete", 0, ()))
    deleted = await commit(database, deletion, 1, deleted=True)
    assert await pins(database) == (set(), set())
    assert await commit(database, deletion, 1, deleted=True) == deleted
    with pytest.raises(AssetError) as no_resurrection:
        await stage(database, change("recreate", 1))
    assert no_resurrection.value.status == 404
    with pytest.raises(AssetError) as changed_receipt:
        await commit(database, deletion, 1, deleted=False)
    assert changed_receipt.value.code == "reference_receipt_conflict"
    assert (
        await changes.status(owner="alpha", service="thought", intent_id=prepared["intent_id"])
    )["state"] == "committed"


async def test_projection_replacement_cannot_bypass_pending_intents_or_account_ownership(assets):
    database, references = assets
    await references.replace(owner="alpha", service="thought", update=update())
    value = change("a")
    prepared = await stage(database, value)
    with pytest.raises(AssetError) as blocked:
        await references.replace(
            owner="alpha", service="thought", update=update("bypass", 2, ("three",), 6)
        )
    assert blocked.value.code == "reference_mutations_pending"
    for owner, service in (("beta", "thought"), ("alpha", "visual")):
        with pytest.raises(AssetError) as denied:
            await ReferenceChanges(database).abort(
                owner=owner, service=service, intent_id=prepared["intent_id"]
            )
        assert denied.value.status == 404
    with pytest.raises(AssetError) as replay_changed:
        await stage(database, change("a", files=("three",)))
    assert replay_changed.value.code == "request_id_conflict"
    assert await pins(database) == ({"one"}, {"two"})


async def test_pending_intents_cannot_be_bypassed_by_direct_asset_deletion(assets):
    from sqlalchemy import delete
    from sqlalchemy.exc import IntegrityError

    from studio.apps.asset_library.storage.models import VisualAsset

    database, references = assets
    await references.replace(owner="alpha", service="thought", update=update())
    await stage(database, change("unknown"))
    async with database.sessions() as session:
        session.info["owner_user_id"] = "alpha"
        with pytest.raises(IntegrityError):
            await session.execute(delete(VisualAsset).where(VisualAsset.id == "two"))
