"""Catalog mutation tests use only catalog tables, never a workshop database."""

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import select

from studio.apps.model_service.catalog.service import (
    CatalogResourceBusyError,
    ModelCatalogService,
    ResourceNotFoundError,
)
from studio.apps.model_service.storage.models.local_models import LocalModelInstallation
from studio.apps.model_service.storage.models.model_service import (
    ModelCatalogState,
    ModelEntry,
    ModelProvider,
)
from studio.apps.model_service.storage.models.model_supplier import ModelSupplier
from studio.runtime.database.orm_base import Base
from studio.runtime.database.sessions import Database
from studio.runtime.revisions import RevisionConflictError
from studio.runtime.secrets import SecretCipher


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
        service = ModelCatalogService(
            session, task_usage=usage, cipher=SecretCipher(Fernet.generate_key().decode())
        )
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
            await ModelCatalogService(
                session, task_usage=usage, cipher=SecretCipher(Fernet.generate_key().decode())
            ).delete_provider("provider", 0)
        assert usage.calls == []


async def test_missing_write_port_fails_closed_and_owned_result_needs_no_workshop_table(catalog):
    async with catalog.sessions() as session:
        session.info["owner_user_id"] = "alpha"
        with pytest.raises(RuntimeError, match="任务占用检查"):
            await ModelCatalogService(
                session, cipher=SecretCipher(Fernet.generate_key().decode())
            ).delete_model("model", 0)
        await session.rollback()
        service = ModelCatalogService(
            session,
            task_usage=Occupancy(False),
            cipher=SecretCipher(Fernet.generate_key().decode()),
        )
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
            await ModelCatalogService(
                session, cipher=SecretCipher(Fernet.generate_key().decode())
            ).catalog()
        service = ModelCatalogService(
            session, defaults_store=defaults, cipher=SecretCipher(Fernet.generate_key().decode())
        )
        view = await service.catalog()
        assert view.default_model_ids == {"chat": "model"}
        with pytest.raises(RevisionConflictError) as error:
            await service.advance_revision(99)
        assert error.value.snapshot["default_model_ids"] == {"chat": "model"}
        assert error.value.snapshot["revision"] == 0
        assert defaults.owners == ["alpha", "alpha"]


async def test_default_update_rejects_foreign_owner_before_mutation(catalog):
    from studio.apps.model_service.catalog.defaults import update_defaults
    from studio.contracts.model_service.schemas.model_service import ModelDefaultsIn

    async with catalog.sessions() as session:
        session.info["owner_user_id"] = "alpha"
        with pytest.raises(ValueError, match="归属"):
            await update_defaults(
                session,
                "other",
                ModelDefaultsIn(expected_revision=0, default_model_ids={}),
                defaults_store=Defaults(),
                cipher=SecretCipher(Fernet.generate_key().decode()),
            )
        assert (await session.get(ModelCatalogState, "alpha")).revision == 0


class MemoryCipher:
    """An opaque credential vault double, deliberately unrelated to Fernet/configuration."""

    def __init__(self):
        self.values = {}

    def encrypt(self, value):
        token = f"opaque-{len(self.values)}"
        self.values[token] = value
        return token

    def decrypt(self, token):
        return self.values[token]

    def hint(self, token):
        return self.decrypt(token)[-4:] if token else ""


@pytest.mark.parametrize(
    "cipher_factory", [MemoryCipher, lambda: SecretCipher(Fernet.generate_key().decode())]
)
async def test_catalog_credential_adapter_is_replaceable_and_survives_component_recreation(
    catalog, cipher_factory
):
    from studio.contracts.model_service.schemas.model_service import ProviderIn

    cipher = cipher_factory()
    async with catalog.sessions(info={"owner_user_id": "alpha"}) as session:
        service = ModelCatalogService(
            session, cipher=cipher, task_usage=Occupancy(False), defaults_store=Defaults()
        )
        _, provider = await service.create_provider(
            ProviderIn(
                expected_catalog_revision=0,
                name="isolated",
                kind="openai",
                api_key="synthetic-value-1234",
            )
        )
        assert provider.api_key_hint == "1234" and provider.has_api_key
        row = await session.get(ModelProvider, provider.id)
        assert row.api_key_ciphertext != "synthetic-value-1234"
        assert cipher.decrypt(row.api_key_ciphertext) == "synthetic-value-1234"
    async with catalog.sessions(info={"owner_user_id": "alpha"}) as session:
        recreated = ModelCatalogService(session, cipher=cipher, defaults_store=Defaults())
        snapshot = await recreated.catalog()
        provider = next(item for item in snapshot.providers if item.id == provider.id)
        assert provider.api_key_hint == "1234"
        assert "synthetic-value-1234" not in snapshot.model_dump_json()
