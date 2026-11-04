"""Retention uses the Assets database only; all constructed data is test-local."""

import asyncio

import pytest
from pydantic import ValidationError
from sqlalchemy import delete, select, text
from sqlalchemy.exc import IntegrityError

from app.capabilities.asset_store.library import AssetError
from app.capabilities.asset_store.models import VisualAsset
from fpl_assets.migration_models import AssetImportReceipt
from fpl_assets.migrations.registry import MIGRATIONS
from fpl_assets.models import MODELS, AssetReferencePin, AssetReferenceReceipt
from fpl_assets.references import AssetReferences, protect_references
from fpl_runtime.asset_references import ReferenceUpdate
from fpl_runtime.database import Database
from fpl_runtime.migrations import apply, check


@pytest.fixture
async def assets(tmp_path):
    apply(tmp_path / "service.db", "assets", MIGRATIONS)
    database = Database("assets", tmp_path, models=MODELS)
    async with database.sessions() as session:
        session.info["owner_user_id"] = "alpha"
        session.add_all(
            [
                VisualAsset(
                    id=key,
                    owner_user_id="alpha",
                    original_filename=key + ".png",
                    display_name=key,
                    storage_key=key,
                    storage_version=2,
                    media_kind="image",
                    mime_type="image/png",
                    byte_size=20,
                )
                for key in ("one", "two", "three")
            ]
        )
        await session.commit()
    async with database.sessions() as session:
        session.info["owner_user_id"] = "beta"
        session.add(
            VisualAsset(
                id="private",
                owner_user_id="beta",
                original_filename="p.png",
                display_name="Private",
                storage_key="private",
                storage_version=2,
                media_kind="image",
                mime_type="image/png",
                byte_size=20,
            )
        )
        await session.commit()
    try:
        yield database, AssetReferences(database)
    finally:
        await database.close()


def update(request="first", revision=0, assets=("one",), resource_revision=5):
    return ReferenceUpdate(
        request_id=request,
        resource_kind="note",
        resource_id="owned-note",
        resource_revision=resource_revision,
        expected_revision=revision,
        asset_ids=list(assets),
    )


async def test_retains_union_then_committed_set_and_replays_receipts(assets):
    database, references = assets
    first = await references.replace(owner="alpha", service="thought", update=update())
    assert first == {"revision": 1, "resource_revision": 5, "asset_ids": ["one"]}
    prepared = update("prepare", 1, ("one", "two"), 5)
    result = await references.replace(owner="alpha", service="thought", update=prepared)
    assert result["revision"] == 2
    assert await references.replace(owner="alpha", service="thought", update=prepared) == result
    async with database.sessions() as session:
        session.info["owner_user_id"] = "alpha"
        await session.execute(text("BEGIN IMMEDIATE"))
        with pytest.raises(AssetError, match="仍被应用"):
            await protect_references(session, ["one", "two"])
    final = update("finalize", 2, ("two",), 6)
    assert (await references.replace(owner="alpha", service="thought", update=final))[
        "revision"
    ] == 3
    # A delayed retry gets its original acknowledgement, never rewinds newer state.
    assert await references.replace(owner="alpha", service="thought", update=prepared) == result
    async with database.sessions() as session:
        session.info["owner_user_id"] = "alpha"
        assert list((await session.scalars(select(AssetReferencePin.asset_id))).all()) == ["two"]
        await protect_references(session, ["one"])
        await session.execute(delete(VisualAsset).where(VisualAsset.id == "one"))
        await session.commit()
    # Restart/reopen preserves the receipt and current pin set.
    check(database.path, "assets", MIGRATIONS)
    restored = Database("assets", database.root, models=MODELS)
    try:
        assert await AssetReferences(restored).replace(
            owner="alpha", service="thought", update=final
        ) == {"revision": 3, "resource_revision": 6, "asset_ids": ["two"]}
    finally:
        await restored.close()


async def test_reference_conflicts_are_atomic_and_cross_account_files_are_absent(assets):
    database, references = assets
    first = update()
    await references.replace(owner="alpha", service="thought", update=first)
    for invalid, code in (
        (update(assets=("two",)), "request_id_conflict"),
        (update("stale", 0, ("two",)), "revision_conflict"),
        (update("old", 1, ("two",), 4), "resource_revision_conflict"),
        (update("missing", 1, ("private",)), "not_found"),
    ):
        with pytest.raises(AssetError) as error:
            await references.replace(owner="alpha", service="thought", update=invalid)
        assert error.value.code == code
    with pytest.raises(AssetError) as error:
        await references.replace(owner="beta", service="thought", update=first)
    assert error.value.status == 404
    async with database.sessions() as session:
        session.info["owner_user_id"] = "alpha"
        assert len((await session.scalars(select(AssetReferenceReceipt))).all()) == 1
        assert list((await session.scalars(select(AssetReferencePin.asset_id))).all()) == ["one"]
        with pytest.raises(IntegrityError):
            await session.execute(delete(VisualAsset).where(VisualAsset.id == "one"))


async def test_competing_reference_updates_have_one_winner(assets):
    database, references = assets
    await references.replace(owner="alpha", service="thought", update=update())
    results = await asyncio.gather(
        references.replace(owner="alpha", service="thought", update=update("a", 1, ("two",), 6)),
        references.replace(owner="alpha", service="thought", update=update("b", 1, ("three",), 6)),
        return_exceptions=True,
    )
    assert sum(isinstance(result, dict) for result in results) == 1
    assert sum(isinstance(result, AssetError) for result in results) == 1
    async with database.sessions() as session:
        session.info["owner_user_id"] = "alpha"
        assert len((await session.scalars(select(AssetReferencePin))).all()) == 1
        assert len((await session.scalars(select(AssetReferenceReceipt))).all()) == 2


def test_reference_protocol_rejects_unknown_consumers_and_invalid_assets():
    with pytest.raises(ValueError, match="调用方"):
        update().validate_service("gateway")
    with pytest.raises(ValueError, match="调用方"):
        update().validate_service("visual")
    for fields in (
        {"asset_ids": ["one", "one"]},
        {"asset_ids": ["../secret"]},
        {"resource_revision": True},
        {"owner_user_id": "beta"},
    ):
        with pytest.raises(ValidationError):
            ReferenceUpdate.model_validate({**update().model_dump(), **fields})


async def test_assets_schema_has_no_foreign_service_tables_or_foreign_keys(assets):
    database, _references = assets
    expected = {model.__tablename__ for model in (*MODELS, AssetImportReceipt)}
    assert AssetImportReceipt not in MODELS
    async with database.engine.connect() as connection:
        names = set(
            (
                await connection.exec_driver_sql(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                )
            ).scalars()
        )
        assert names == expected | {"_fpl_service_schema"}
        for name in sorted(expected):
            keys = (await connection.exec_driver_sql(f'PRAGMA foreign_key_list("{name}")')).all()
            assert all(row[2] in expected for row in keys)
        assert (await connection.exec_driver_sql("PRAGMA integrity_check")).scalar() == "ok"
        assert not (await connection.exec_driver_sql("PRAGMA foreign_key_check")).all()


async def test_same_source_revision_cannot_drop_a_competing_prepared_asset(assets):
    database, references = assets
    await references.replace(owner="alpha", service="thought", update=update())
    await references.replace(
        owner="alpha",
        service="thought",
        update=update(
            "prepare-a",
            1,
            ("one", "two"),
            5,
        ),
    )
    # B may observe A's latest Assets CAS, while its source document is still at 5.
    # Replacing only B's union would expose A's prospective file to deletion.
    with pytest.raises(AssetError) as blocked:
        await references.replace(
            owner="alpha",
            service="thought",
            update=update(
                "prepare-b",
                2,
                ("one", "three"),
                5,
            ),
        )
    assert blocked.value.code == "pending_reference_conflict"
    async with database.sessions() as session:
        session.info["owner_user_id"] = "alpha"
        assert set((await session.scalars(select(AssetReferencePin.asset_id))).all()) == {
            "one",
            "two",
        }
