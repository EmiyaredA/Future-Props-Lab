"""Catalog mutation tests use only catalog tables, never a workshop database."""

import pytest
from sqlalchemy import select

from app.llm.catalog.service import (
    CatalogResourceBusyError,
    ModelCatalogService,
    ResourceNotFoundError,
)
from app.llm.models import ModelCatalogState, ModelEntry, ModelProvider, ModelSupplier
from app.runtime.orm_base import Base
from fpl_runtime.database import Database


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
    models = (ModelCatalogState, ModelProvider, ModelEntry, ModelSupplier)
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
