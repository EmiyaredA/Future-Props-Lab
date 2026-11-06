"""Unknown integration runs retain capacity until owned durable evidence exists."""

import asyncio
from uuid import uuid4

import pytest
from fastapi import HTTPException

from studio.apps.integrations.clients.authority import IntegrationAuthorizationUnavailable
from studio.apps.integrations.records import ValidationAttempt
from studio.apps.integrations.storage.migrations.registry import MIGRATIONS
from studio.apps.integrations.storage.native_mcp_records import NativeMcpJob
from studio.apps.integrations.storage.service_models import MODELS
from studio.apps.integrations.validation import ValidationRecovery
from studio.contracts.integrations.integration_intents import IntegrationScope
from studio.runtime.database.migrations import apply
from studio.runtime.database.sessions import Database


class Capacity:
    def __init__(self):
        self.outcomes = {}
        self.unavailable = False

    async def change(self, identity, operation, *, outcome=None):
        assert operation == "release"
        if self.unavailable:
            raise IntegrationAuthorizationUnavailable("synthetic outage")
        prior = self.outcomes.setdefault(identity, outcome)
        assert prior == outcome


@pytest.fixture
async def recovery(tmp_path):
    apply(tmp_path / "service.db", "integrations", MIGRATIONS)
    database = Database(
        "integrations",
        tmp_path,
        models=MODELS,
        account_models=tuple(model for model in MODELS if hasattr(model, "owner_user_id")),
    )
    capacity = Capacity()
    recovery = ValidationRecovery(database, None, capacity)
    try:
        yield recovery
    finally:
        await database.close()


async def attempt(recovery, owner="alpha", kind="mcp.validate"):
    identity = str(uuid4())
    scope = IntegrationScope(
        kind=kind,
        task_id=uuid4(),
        connection_id="owned-connection",
        connection_revision=1,
        input_sha256="a" * 64,
    )
    async with recovery.database.sessions(info={"owner_user_id": owner}) as session:
        session.add(
            ValidationAttempt(
                id=identity,
                owner_user_id=owner,
                scope=scope.model_dump(mode="json"),
                status="unknown",
            )
        )
        await session.commit()
    return identity


async def job(recovery, identity, *, status, error="", receipt=None, worker=""):
    async with recovery.database.sessions(info={"owner_user_id": "alpha"}) as session:
        session.add(
            NativeMcpJob(
                id=str(uuid4()),
                owner_user_id="alpha",
                request_id=identity,
                operation="integrations.mcp-discover",
                payload_sha256="b" * 64,
                payload={
                    "intent_id": identity,
                    "connection_id": "owned-connection",
                    "connection_revision": 1,
                    "input_sha256": "a" * 64,
                },
                status=status,
                error_code=error,
                outcome_sha256=receipt,
                worker_id=worker,
            )
        )
        await session.commit()


@pytest.mark.asyncio
async def test_unknown_remote_and_live_native_do_not_release_capacity(recovery):
    remote = await attempt(recovery, kind="tool.validate")
    native = await attempt(recovery)
    await job(recovery, native, status="unknown", worker="worker")
    for identity in (remote, native):
        with pytest.raises(HTTPException) as error:
            await recovery.reconcile("alpha", identity)
        assert error.value.status_code == 409
    assert not recovery.capacity.outcomes
    assert len((await recovery.list_pending("alpha")).items) == 2
    assert (await recovery.list_pending("beta")).items == []
    with pytest.raises(HTTPException) as error:
        await recovery.reconcile("beta", native)
    assert error.value.status_code == 404


@pytest.mark.asyncio
async def test_native_terminal_receipt_recovers_once_and_survives_retry(recovery):
    identity = await attempt(recovery)
    await job(recovery, identity, status="completed", receipt="c" * 64, worker="worker")
    result = await recovery.reconcile("alpha", identity)
    assert result.status == "completed" and result.released
    assert (await recovery.reconcile("alpha", identity)).released
    assert recovery.capacity.outcomes == {identity: "completed"}
    assert (await recovery.list_pending("alpha")).items == []


@pytest.mark.asyncio
async def test_undispatched_cancellation_and_outage_settle_without_reexecution(recovery):
    identity = await attempt(recovery)
    await job(recovery, identity, status="failed", error="dispatch_cancelled")
    recovery.capacity.unavailable = True
    result = await recovery.reconcile("alpha", identity)
    assert result.status == "not-started" and not result.released
    assert (await recovery.list_pending("alpha")).items[0].status == "not-started"
    recovery.capacity.unavailable = False
    assert (await recovery.reconcile("alpha", identity)).released
    assert recovery.capacity.outcomes == {identity: "not-started"}


@pytest.mark.asyncio
async def test_concurrent_reconciliation_replays_same_capacity_receipt(recovery):
    identity = await attempt(recovery)
    await job(recovery, identity, status="completed", receipt="c" * 64, worker="worker")
    left, right = await asyncio.gather(
        recovery.reconcile("alpha", identity), recovery.reconcile("alpha", identity)
    )
    assert left.released and right.released
    assert recovery.capacity.outcomes == {identity: "completed"}


@pytest.mark.asyncio
async def test_foreign_or_tampered_native_evidence_cannot_release(recovery):
    identity = await attempt(recovery)
    await job(recovery, identity, status="completed", receipt="c" * 64, worker="worker")
    async with recovery.database.sessions(info={"owner_user_id": "alpha"}) as session:
        from sqlalchemy import select

        record = await session.scalar(
            select(NativeMcpJob).where(NativeMcpJob.request_id == identity)
        )
        record.payload = {**record.payload, "input_sha256": "d" * 64}
        await session.commit()
    with pytest.raises(HTTPException) as error:
        await recovery.reconcile("alpha", identity)
    assert error.value.status_code == 409
    assert recovery.capacity.outcomes == {}


@pytest.mark.asyncio
async def test_pending_attempts_are_bounded_and_paginated_per_owner(recovery):
    identities = [await attempt(recovery) for _ in range(101)]
    await attempt(recovery, owner="beta")
    first = await recovery.list_pending("alpha")
    second = await recovery.list_pending("alpha", offset=100)
    assert len(first.items) == 100 and first.has_more
    assert len(second.items) == 1 and not second.has_more
    assert {item.id for item in [*first.items, *second.items]} == set(identities)
    assert len((await recovery.list_pending("beta")).items) == 1
