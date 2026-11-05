"""Catalog mutation tests use only catalog tables, never a workshop database."""

import pytest
from sqlalchemy import select

from app.llm.catalog.service import (
    CatalogResourceBusyError,
    ModelCatalogService,
    ResourceNotFoundError,
)
from app.llm.models import (
    LocalModelInstallation,
    ModelCatalogState,
    ModelEntry,
    ModelProvider,
    ModelSupplier,
)
from studio.runtime.database.orm_base import Base
from studio.runtime.database.sessions import Database
from studio.runtime.revisions import RevisionConflictError


class Occupancy:
    def __init__(self, busy):
        self.busy = busy
        self.calls = []

    async def provider_active(self, **values):
        self.calls.append(("provider", values))
        return self.busy

    async def model_active(self, **values):
        self.calls.append(("model", values))
        return self.busy


@pytest.fixture
async def catalog(tmp_path):
    models = (ModelCatalogState, ModelProvider, ModelEntry, ModelSupplier, LocalModelInstallation)
    database = Database("models", tmp_path, models=models)
    async with database.engine.begin() as connection:
        await connection.run_sync(
            lambda sync: Base.metadata.create_all(sync, tables=[m.__table__ for m in models])
        )
    async with database.sessions() as session:
        session.info["owner_user_id"] = "alpha"
        session.add_all(
            [
                ModelCatalogState(owner_user_id="alpha", revision=0),
                ModelProvider(id="provider", owner_user_id="alpha", name="own", kind="openai"),
            ]
        )
        await session.flush()
        session.add(
            ModelEntry(id="model", owner_user_id="alpha", provider_id="provider", slug="own")
        )
        await session.commit()
    try:
        yield database
    finally:
        await database.close()


@pytest.mark.parametrize("kind", ["provider", "model"])
async def test_busy_catalog_write_uses_explicit_account_bound_occupancy(catalog, kind):
    usage = Occupancy(True)
    async with catalog.sessions() as session:
        session.info["owner_user_id"] = "alpha"
        service = ModelCatalogService(session, task_usage=usage)
        with pytest.raises(CatalogResourceBusyError):
            if kind == "provider":
                await service.delete_provider("provider", 0)
            else:
                await service.delete_model("model", 0)
        assert usage.calls == [(kind, {"owner_user_id": "alpha", kind + "_id": kind})]
        assert (await session.get(ModelCatalogState, "alpha")).revision == 0
        assert await session.get(ModelEntry, "model") is not None


async def test_foreign_provider_is_absent_before_any_occupancy_lookup(catalog):
    usage = Occupancy(True)
    async with catalog.sessions() as session:
        session.info["owner_user_id"] = "beta"
        with pytest.raises(ResourceNotFoundError):
            await ModelCatalogService(session, task_usage=usage).delete_provider("provider", 0)
        assert usage.calls == []


async def test_missing_write_port_fails_closed_and_owned_result_needs_no_workshop_table(catalog):
    async with catalog.sessions() as session:
        session.info["owner_user_id"] = "alpha"
        with pytest.raises(RuntimeError, match="任务占用检查"):
            await ModelCatalogService(session).delete_model("model", 0)
        await session.rollback()
        service = ModelCatalogService(session, task_usage=Occupancy(False))
        assert await service.delete_model("model", 0) == 1
        assert (await session.scalars(select(ModelEntry))).all() == []


class Defaults:
    def __init__(self):
        self.owners = []

    async def read(self, *, owner_user_id):
        self.owners.append(owner_user_id)
        return {"chat": "model"}


async def test_catalog_reads_only_explicit_account_defaults_and_preserves_cas_snapshot(catalog):
    defaults = Defaults()
    async with catalog.sessions() as session:
        session.info["owner_user_id"] = "alpha"
        with pytest.raises(RuntimeError, match="默认模型存储"):
            await ModelCatalogService(session).catalog()
        service = ModelCatalogService(session, defaults_store=defaults)
        view = await service.catalog()
        assert view.default_model_ids == {"chat": "model"}
        with pytest.raises(RevisionConflictError) as error:
            await service.advance_revision(99)
        assert error.value.snapshot["default_model_ids"] == {"chat": "model"}
        assert error.value.snapshot["revision"] == 0
        assert defaults.owners == ["alpha", "alpha"]


async def test_default_update_rejects_foreign_owner_before_mutation(catalog):
    from app.llm.catalog.defaults import update_defaults
    from studio.contracts.model_service.schemas.model_service import ModelDefaultsIn

    async with catalog.sessions() as session:
        session.info["owner_user_id"] = "alpha"
        with pytest.raises(ValueError, match="归属"):
            await update_defaults(
                session,
                "other",
                ModelDefaultsIn(expected_revision=0, default_model_ids={}),
                defaults_store=Defaults(),
            )
        assert (await session.get(ModelCatalogState, "alpha")).revision == 0
