"""Role policy and stable-ID merges work with only the independently owned Models schema."""

import asyncio
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest
from sqlalchemy import select

from app.llm.catalog.template_reconciliation import apply_template
from app.llm.models import ModelCatalogState, ModelEntry, ModelInferenceTask, ModelProvider
from app.runtime.credentials import decrypt_secret
from studio.apps.model_service.admission.task_usage import OwnedCatalogTaskUsage
from studio.apps.model_service.defaults import OwnedCatalogDefaults
from studio.apps.model_service.provisioning import CatalogProvisioning
from studio.apps.model_service.storage.migrations.registry import MIGRATIONS
from studio.apps.model_service.storage.service_models import (
    ACCOUNT_MODELS,
    MODELS,
    AccountDefaults,
    RoleTemplate,
)
from studio.apps.model_service.templates import RoleTemplates, initialize_account_catalog
from studio.contracts.identity.errors import AccountError
from studio.contracts.model_service.catalog_events import CatalogDelivery
from studio.contracts.model_service.schemas.model_templates import RoleModelTemplateIn
from studio.runtime.database.migrations import apply
from studio.runtime.database.sessions import Database


def policy(revision=0, *, name="User policy", key="synthetic-role-secret", clear=False):
    return RoleModelTemplateIn(
        expected_revision=revision,
        value={
            "providers": [
                {
                    "template_key": "provider",
                    "name": name,
                    "kind": "openai",
                    "base_url": "https://provider.invalid/v1",
                    "api_key": key,
                    "clear_api_key": clear,
                    "models": [
                        {"template_key": "model", "slug": "fixture", "capabilities": ["chat"]}
                    ],
                }
            ],
            "defaults": {"chat": "model"},
        },
    )


def delivery(owner):
    return CatalogDelivery(
        event={
            "id": "created-" + owner,
            "type": "account.created",
            "payload": {"user_id": owner, "platform_role": "admin"},
            "revision": 0,
        },
        account={"user_id": owner, "platform_role": "user", "revision": 4},
        expires_at=int(time.time()) + 20,
    )


@pytest.fixture
async def database(tmp_path):
    apply(tmp_path / "service.db", "models", MIGRATIONS)
    database = Database("models", tmp_path, models=MODELS, account_models=ACCOUNT_MODELS)
    try:
        yield database
    finally:
        await database.close()


async def test_owned_policy_cas_secret_replacement_preservation_and_clear(database):
    ciphertext = None
    for revision, key, clear in (
        (0, "synthetic-role-secret", False),
        (1, "", False),
        (2, "synthetic-replacement-secret", False),
        (3, "", True),
    ):
        async with database.sessions() as session:
            view = await RoleTemplates(session).save("user", policy(revision, key=key, clear=clear))
            assert view["revision"] == revision + 1
            serialized = json.dumps(view)
            assert "ciphertext" not in serialized and "synthetic-role-secret" not in serialized
            if key:
                assert key not in serialized
            await session.commit()
        async with database.sessions() as session:
            row = await session.get(RoleTemplate, "user")
            value = row.payload["providers"][0]
            assert not {"api_key", "clear_api_key", "has_api_key", "api_key_hint"}.intersection(
                value
            )
            if revision == 1:
                assert value["api_key_ciphertext"] == ciphertext
            elif key:
                assert decrypt_secret(value["api_key_ciphertext"]) == key
            else:
                assert value["api_key_ciphertext"] == ""
            ciphertext = value["api_key_ciphertext"]
    async with database.sessions() as session:
        with pytest.raises(AccountError) as conflict:
            await RoleTemplates(session).save("user", policy(1))
        assert conflict.value.code == "revision_conflict"
        assert conflict.value.current["revision"] == 4
        assert "ciphertext" not in json.dumps(conflict.value.current)


async def test_concurrent_policy_creation_has_one_cas_winner(database, monkeypatch):
    barrier = asyncio.Barrier(2)
    snapshot = RoleTemplates.snapshot

    async def simultaneous(self, role):
        state = await snapshot(self, role)
        if state["revision"] == 0:
            await barrier.wait()
        return state

    monkeypatch.setattr(RoleTemplates, "snapshot", simultaneous)

    async def save(name):
        async with database.sessions() as session:
            try:
                await RoleTemplates(session).save("user", policy(name=name))
                await session.commit()
                return "saved"
            except AccountError as exc:
                return exc.code

    assert sorted(await asyncio.wait_for(asyncio.gather(save("First"), save("Second")), 8)) == [
        "revision_conflict",
        "saved",
    ]


async def seed_role_accounts(database):
    async with database.sessions() as session:
        await RoleTemplates(session).save("user", policy())
        await RoleTemplates(session).save("admin", policy(name="Admin policy", key="admin-secret"))
        await session.commit()
    consumer = CatalogProvisioning(database.sessions, initializer=initialize_account_catalog)
    for owner in ("alpha", "beta"):
        await consumer.apply(delivery(owner))
    return consumer


async def test_no_role_policy_uses_the_existing_no_key_builtin_catalogue(database):
    consumer = CatalogProvisioning(database.sessions, initializer=initialize_account_catalog)
    await consumer.apply(delivery("alpha"))
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        providers = list(await session.scalars(select(ModelProvider)))
        assert len(providers) > 1 and all(not row.api_key_ciphertext for row in providers)
        assert (await session.get(ModelCatalogState, "alpha")).revision == 1
        assert (await session.get(AccountDefaults, "alpha")).model_ids == {}


async def test_event_initializer_applies_current_owned_policy_and_replay_keeps_ids(database):
    consumer = await seed_role_accounts(database)
    ids = []
    for owner in ("alpha", "beta"):
        async with database.sessions(info={"owner_user_id": owner}) as session:
            providers = list(await session.scalars(select(ModelProvider)))
            models = list(await session.scalars(select(ModelEntry)))
            assert len(providers) == len(models) == 1
            assert providers[0].name == "User policy" and providers[0].origin == "role_template"
            assert decrypt_secret(providers[0].api_key_ciphertext) == "synthetic-role-secret"
            assert (await session.get(AccountDefaults, owner)).model_ids == {"chat": models[0].id}
            assert (await session.get(ModelCatalogState, owner)).revision == 1
            ids.append(models[0].id)
    assert ids[0] != ids[1]
    async with database.sessions() as session:
        await RoleTemplates(session).save("user", policy(1, name="Updated policy", key=""))
        await session.commit()
    await consumer.apply(delivery("alpha"))
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        model = await session.scalar(select(ModelEntry))
        assert model.id == ids[0]
        assert (await session.scalar(select(ModelProvider))).name == "User policy"


async def test_reconciliation_retains_private_models_default_choices_and_cas(database):
    await seed_role_accounts(database)
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        inherited = await session.scalar(select(ModelEntry))
        inherited_id = inherited.id
        session.add(
            ModelProvider(
                id="custom-provider", owner_user_id="alpha", name="Private", kind="openai"
            )
        )
        await session.flush()
        session.add(
            ModelEntry(
                id="custom-model",
                owner_user_id="alpha",
                provider_id="custom-provider",
                slug="private",
                capabilities=["chat"],
            )
        )
        await session.flush()
        await OwnedCatalogDefaults(session).replace(
            owner_user_id="alpha", model_ids={"chat": "custom-model"}
        )
        await session.commit()
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        snapshot = await RoleTemplates(session).snapshot("user")
        snapshot["value"]["providers"][0]["models"][0]["label"] = "Updated label"
        await apply_template(
            session,
            "alpha",
            snapshot["value"],
            1,
            defaults_store=OwnedCatalogDefaults(session),
            task_usage=OwnedCatalogTaskUsage(session),
        )
        await session.commit()
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        assert (await session.get(ModelEntry, inherited_id)).label == "Updated label"
        assert (await session.get(AccountDefaults, "alpha")).model_ids == {"chat": "custom-model"}
        assert (await session.get(ModelCatalogState, "alpha")).revision == 2
        with pytest.raises(AccountError) as stale:
            await apply_template(
                session,
                "alpha",
                snapshot["value"],
                1,
                defaults_store=OwnedCatalogDefaults(session),
                task_usage=OwnedCatalogTaskUsage(session),
            )
        assert stale.value.code == "catalog_revision_conflict"
        with pytest.raises(ValueError, match="账号上下文"):
            await apply_template(
                session,
                "beta",
                snapshot["value"],
                1,
                defaults_store=OwnedCatalogDefaults(session),
                task_usage=OwnedCatalogTaskUsage(session),
            )
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        await apply_template(
            session,
            "alpha",
            {"providers": [], "defaults": {}},
            2,
            defaults_store=OwnedCatalogDefaults(session),
            task_usage=OwnedCatalogTaskUsage(session),
        )
        await session.commit()
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        assert {row.id for row in await session.scalars(select(ModelEntry))} == {
            inherited_id,
            "custom-model",
        }
        assert (await session.get(AccountDefaults, "alpha")).model_ids == {"chat": "custom-model"}
        conflict = await RoleTemplates(session).snapshot("user")
        conflict["value"]["providers"][0]["name"] = "Private"
        with pytest.raises(AccountError) as collision:
            await apply_template(
                session,
                "alpha",
                conflict["value"],
                3,
                defaults_store=OwnedCatalogDefaults(session),
                task_usage=OwnedCatalogTaskUsage(session),
            )
        assert collision.value.code == "template_catalog_conflict"
        assert (await session.get(ModelCatalogState, "alpha")).revision == 3
        persisted = await RoleTemplates(session).snapshot("user")
        assert persisted["value"]["providers"][0]["name"] == "User policy"


async def test_owned_task_occupancy_blocks_template_changes_for_only_its_account(database):
    await seed_role_accounts(database)
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        provider = await session.scalar(select(ModelProvider))
        model = await session.scalar(select(ModelEntry))
        session.add(
            ModelInferenceTask(
                owner_user_id="alpha",
                provider_id=provider.id,
                model_id=model.id,
                request_id="request",
                fingerprint="f" * 64,
                provider_kind="openai",
                provider_name="Fixture",
                model_slug="fixture",
                kind="image",
            )
        )
        await session.commit()
        usage = OwnedCatalogTaskUsage(session)
        assert await usage.provider_active(owner_user_id="alpha", provider_id=provider.id)
        assert await usage.model_active(owner_user_id="alpha", model_id=model.id)
    for owner in ("alpha", "beta"):
        async with database.sessions(info={"owner_user_id": owner}) as session:
            snapshot = await RoleTemplates(session).snapshot("user")
            merge = apply_template(
                session,
                owner,
                snapshot["value"],
                1,
                defaults_store=OwnedCatalogDefaults(session),
                task_usage=OwnedCatalogTaskUsage(session),
            )
            if owner == "alpha":
                with pytest.raises(AccountError) as busy:
                    await merge
                assert busy.value.code == "template_catalog_conflict"
                assert (await session.get(ModelCatalogState, owner)).revision == 1
            else:
                await merge
                await session.commit()


def test_owned_role_policy_imports_no_recovery_database_or_foreign_orm(tmp_path):
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys; import studio.apps.model_service.templates; "
            "assert 'studio.runtime.database.website' not in sys.modules; "
            "assert not any(n.startswith(('app.console.models', 'app.apps.')) "
            "for n in sys.modules)",
        ],
        cwd=root,
        env={
            **os.environ,
            "PYTHONPATH": str(root / "backend"),
            "FPL_CONFIG_FILE": str(tmp_path / "absent.toml"),
            "FPL_SECRETS_KEY": "",
        },
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert result.returncode == 0, result.stdout + result.stderr
