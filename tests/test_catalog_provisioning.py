"""Account-created deliveries are replayable without sharing Identity storage."""

import asyncio
import time

import httpx
import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.llm.catalog.seed import ensure_account_model_catalog
from app.llm.models import ModelCatalogState, ModelProvider
from studio.apps.model_service.account_events import CatalogEventClient, CatalogEventTransportError
from studio.apps.model_service.provisioning import (
    CatalogProvisioning,
    CatalogProvisioningConflict,
    CatalogProvisioningExpired,
)
from studio.apps.model_service.storage.migrations.registry import MIGRATIONS
from studio.apps.model_service.storage.service_models import (
    ACCOUNT_MODELS,
    MODELS,
    AccountDefaults,
    CatalogProvisioningReceipt,
)
from studio.contracts.model_service.catalog_events import CatalogDelivery, CatalogEvent
from studio.runtime.database.migrations import apply
from studio.runtime.database.sessions import Database


def event(owner="alpha", *, identity="event-alpha", role="user", revision=0):
    return CatalogEvent(
        id=identity,
        type="account.created",
        payload={"user_id": owner, "platform_role": role},
        revision=revision,
    )


def delivery(owner="alpha", **values):
    value = event(owner, **values)
    return CatalogDelivery(
        event=value,
        account={"user_id": owner, "platform_role": value.payload.platform_role, "revision": 2},
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


async def test_concurrent_delivery_initializes_once_and_rejects_changed_content(database):
    calls = []

    async def initialize(session, owner, role):
        calls.append((owner, role))
        assert session.info["owner_user_id"] == owner
        await ensure_account_model_catalog(session, owner)

    consumer = CatalogProvisioning(database.sessions, initializer=initialize)
    assert (
        await asyncio.gather(*(consumer.apply(delivery()) for _ in range(3))) == ["initialized"] * 3
    )
    assert calls == [("alpha", "user")]
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        before = {row.id for row in await session.scalars(select(ModelProvider))}
        assert len(before) > 1
        assert (await session.get(ModelCatalogState, "alpha")).revision == 1
        assert (await session.get(AccountDefaults, "alpha")).model_ids == {}
        receipt = await session.get(CatalogProvisioningReceipt, "event-alpha")
        assert receipt.event_digest == event().digest()
    for changed in (delivery(role="admin"), delivery(revision=1), delivery("beta")):
        with pytest.raises(CatalogProvisioningConflict):
            await consumer.apply(changed)
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        assert {row.id for row in await session.scalars(select(ModelProvider))} == before
    async with database.sessions(info={"owner_user_id": "beta"}) as session:
        assert await session.get(ModelCatalogState, "beta") is None
        assert list(await session.scalars(select(ModelProvider))) == []


async def test_failed_initialization_rolls_back_then_retry_preserves_existing_configuration(
    database,
):
    async def interrupted(session, owner, _role):
        await ensure_account_model_catalog(session, owner)
        raise RuntimeError("initialization interrupted")

    with pytest.raises(RuntimeError, match="initialization interrupted"):
        await CatalogProvisioning(database.sessions, initializer=interrupted).apply(delivery())
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        assert list(await session.scalars(select(ModelProvider))) == []
        assert await session.get(ModelCatalogState, "alpha") is None
        assert await session.get(CatalogProvisioningReceipt, "event-alpha") is None
        session.add(ModelCatalogState(owner_user_id="alpha", revision=12))
        session.add(AccountDefaults(owner_user_id="alpha", model_ids={"chat": "kept"}, revision=6))
        session.add(
            ModelProvider(id="kept-provider", owner_user_id="alpha", name="Private", kind="openai")
        )
        await session.commit()
    consumer = CatalogProvisioning(database.sessions, initializer=interrupted)
    assert await consumer.apply(delivery()) == "preserved"
    assert await consumer.apply(delivery()) == "preserved"
    with pytest.raises(CatalogProvisioningConflict):
        await consumer.apply(delivery(identity="different-event"))
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        assert (await session.get(ModelCatalogState, "alpha")).revision == 12
        defaults = await session.get(AccountDefaults, "alpha")
        assert defaults.revision == 6 and defaults.model_ids == {"chat": "kept"}
        assert [row.id for row in await session.scalars(select(ModelProvider))] == ["kept-provider"]


async def test_current_role_and_expiry_gate_new_initialization_but_not_known_receipt_settlement(
    database,
):
    calls = []

    async def initialize(session, owner, role):
        calls.append(role)
        await ensure_account_model_catalog(session, owner)

    consumer = CatalogProvisioning(database.sessions, initializer=initialize)
    value = CatalogDelivery(
        event=event(role="admin"),
        account={"user_id": "alpha", "platform_role": "user", "revision": 42},
        expires_at=int(time.time()) - 1,
    )
    with pytest.raises(CatalogProvisioningExpired):
        await consumer.apply(value)
    with pytest.raises(CatalogProvisioningExpired):
        await consumer.apply(
            CatalogDelivery.model_validate(
                {**value.model_dump(), "expires_at": int(time.time()) + 3600}
            )
        )
    assert calls == []
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        assert await session.get(ModelCatalogState, "alpha") is None
    fresh = CatalogDelivery.model_validate(
        {**value.model_dump(), "expires_at": int(time.time()) + 20}
    )
    assert await consumer.apply(fresh) == "initialized"
    assert await consumer.apply(value) == "initialized"
    assert calls == ["user"]
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        receipt = await session.get(CatalogProvisioningReceipt, value.event.id)
        assert receipt.initialization_role == "user" and receipt.account_revision == 42


async def test_unknown_commit_outcome_reuses_the_committed_receipt(database, monkeypatch):
    from sqlalchemy.ext.asyncio import AsyncSession

    calls = []

    async def initialize(session, owner, role):
        calls.append((owner, role))
        await ensure_account_model_catalog(session, owner)

    consumer = CatalogProvisioning(database.sessions, initializer=initialize)
    commit = AsyncSession.commit

    async def interrupted(session):
        await commit(session)
        raise asyncio.CancelledError()

    with monkeypatch.context() as uncertain:
        uncertain.setattr(AsyncSession, "commit", interrupted)
        with pytest.raises(asyncio.CancelledError):
            await consumer.apply(delivery())
    assert await consumer.apply(delivery()) == "initialized"
    assert calls == [("alpha", "user")]


@pytest.mark.parametrize(
    "update",
    [
        {"revision": True},
        {"revision": -1},
        {"type": "account.deleted"},
        {"id": "../event"},
        {"payload": {"user_id": "alpha", "platform_role": "super_admin"}},
        {"payload": {"user_id": "alpha", "platform_role": "user", "password": "forbidden"}},
    ],
)
def test_private_event_contract_rejects_ambiguous_or_excess_data(update):
    with pytest.raises(ValidationError):
        CatalogEvent.model_validate({**event().model_dump(), **update})


@pytest.mark.parametrize("failure", ["redirect", "oversized", "malformed", "wrong_ack"])
async def test_event_transport_is_bounded_and_refuses_redirects_and_unrelated_acknowledgments(
    failure,
):
    requests = []

    async def handler(request):
        requests.append(request.url.host)
        if failure == "redirect":
            return httpx.Response(302, headers={"location": "https://untrusted.invalid/steal"})
        if failure == "oversized":
            return httpx.Response(200, content=b" " * 140000)
        if failure == "wrong_ack":
            return httpx.Response(
                200, json={"id": "other-event", "revision": 1, "acknowledged": True}
            )
        return httpx.Response(200, json={"events": [{"password": "forbidden"}]})

    client = CatalogEventClient(
        credential="fixture-model-token-" * 3, transport=httpx.MockTransport(handler)
    )
    try:
        with pytest.raises(CatalogEventTransportError):
            if failure == "wrong_ack":
                await client.acknowledge(event())
            else:
                await client.pending()
        assert requests == ["identity"]
    finally:
        await client.close()
