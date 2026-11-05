"""Independent defaults preserve catalog CAS without account or platform-setting tables."""

import sqlite3

import pytest

from app.llm.catalog.defaults import update_defaults
from app.llm.models import (
    LocalModelInstallation,
    ModelCatalogState,
    ModelEntry,
    ModelProvider,
    ModelSupplier,
)
from app.llm.schemas.model_service import ModelDefaultsIn
from app.runtime.orm_base import Base
from app.runtime.revisions import RevisionConflictError
from fpl_models.defaults import OwnedCatalogDefaults
from fpl_models.migrations.registry import MIGRATIONS
from fpl_models.models import AccountDefaults
from fpl_runtime.database import Database
from fpl_runtime.migrations import apply, check


def test_defaults_migration_is_owned_idempotent_and_refuses_another_service(tmp_path):
    path = tmp_path / "service.db"
    apply(path, "models", MIGRATIONS[:1])
    apply(path, "models", MIGRATIONS[:1])
    check(path, "models", MIGRATIONS[:1])
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as db:
        assert {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")} == {
            "_fpl_service_schema",
            "model_account_defaults",
        }
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    with pytest.raises(ValueError, match="归属"):
        apply(path, "identity", MIGRATIONS[:1])


@pytest.fixture
async def database(tmp_path):
    apply(tmp_path / "service.db", "models", MIGRATIONS)
    core = (ModelCatalogState, ModelProvider, ModelEntry, ModelSupplier, LocalModelInstallation)
    db = Database("models", tmp_path, models=(*core, AccountDefaults))
    async with db.engine.begin() as connection:
        await connection.run_sync(
            lambda c: Base.metadata.create_all(c, tables=[m.__table__ for m in core])
        )
    async with db.sessions(info={"owner_user_id": "alpha"}) as session:
        session.add(ModelCatalogState(owner_user_id="alpha", revision=0))
        session.add(ModelProvider(id="provider", owner_user_id="alpha", name="own", kind="openai"))
        await session.flush()
        session.add(
            ModelEntry(
                id="model",
                owner_user_id="alpha",
                provider_id="provider",
                slug="own",
                capabilities=["chat"],
            )
        )
        await session.commit()
    try:
        yield db
    finally:
        await db.close()


async def test_default_selection_and_conflict_snapshot_share_the_owned_catalog_transaction(
    database,
):
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        store = OwnedCatalogDefaults(session)
        view = await update_defaults(
            session,
            "alpha",
            ModelDefaultsIn(expected_revision=0, default_model_ids={"chat": "model"}),
            defaults_store=store,
        )
        assert view.revision == 1 and view.default_model_ids == {"chat": "model"}
        with pytest.raises(RevisionConflictError) as conflict:
            await update_defaults(
                session,
                "alpha",
                ModelDefaultsIn(expected_revision=0, default_model_ids={}),
                defaults_store=store,
            )
        assert conflict.value.snapshot["default_model_ids"] == {"chat": "model"}
        assert conflict.value.snapshot["revision"] == 1
        assert (await session.get(AccountDefaults, "alpha")).revision == 1


async def test_invalid_selection_rolls_back_catalog_revision_and_cross_account_access_is_refused(
    database,
):
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        with pytest.raises(ValueError, match="默认模型"):
            await update_defaults(
                session,
                "alpha",
                ModelDefaultsIn(expected_revision=0, default_model_ids={"chat": "foreign-model"}),
                defaults_store=OwnedCatalogDefaults(session),
            )
        await session.rollback()
        assert (await session.get(ModelCatalogState, "alpha")).revision == 0
        assert await session.get(AccountDefaults, "alpha") is None
    async with database.sessions(info={"owner_user_id": "beta"}) as session:
        store = OwnedCatalogDefaults(session)
        with pytest.raises(ValueError, match="账号上下文"):
            await store.read(owner_user_id="alpha")
        with pytest.raises(ValueError, match="账号上下文"):
            await store.replace(owner_user_id="alpha", model_ids={})
        assert await store.read(owner_user_id="beta") == {}
