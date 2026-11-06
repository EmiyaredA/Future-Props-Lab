"""Temporary SQLite storage checks for native leases, ownership and immutable outcomes."""

import asyncio
from datetime import datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import select, update

from studio.apps.agent_workbench.storage.service_models import NativeJob
from studio.contracts.agent_workbench.native import NativeOutcome
from studio.runtime.database.sessions import Database, ServiceStorageError
from studio.runtime.tasks.native_queue import NativeQueue, NativeQueueError


@pytest.fixture
async def queue(tmp_path):
    root = tmp_path / "agents"
    root.mkdir()
    database = Database("agents", root, models=(NativeJob,))
    async with database.engine.begin() as connection:
        await connection.run_sync(NativeJob.__table__.create)
    clock = SimpleNamespace(now=datetime(2026, 11, 2, 10))
    instance = NativeQueue(
        database,
        NativeJob,
        operations={"agent_sources.validate", "agent_sources.watch"},
        clock=lambda: clock.now,
    )
    try:
        yield instance, clock
    finally:
        await database.close()


async def enqueue(queue, owner="a", request_id="one"):
    return await queue.enqueue(
        owner=owner,
        operation="agent_sources.validate",
        payload={"root": "/fixture/" + owner},
        request_id=request_id,
    )


@pytest.mark.asyncio
async def test_requests_and_receipts_are_idempotent_and_account_scoped(queue):
    native, _clock = queue
    first = await enqueue(native)
    assert await enqueue(native) == first
    second = await enqueue(native, owner="b")
    assert second["id"] != first["id"]
    with pytest.raises(NativeQueueError, match="request_conflict"):
        await native.enqueue(
            owner="a",
            operation="agent_sources.validate",
            payload={"root": "/different"},
            request_id="one",
        )
    with pytest.raises(NativeQueueError, match="not_found"):
        await native.get(owner="b", job_id=first["id"])
    assert await native.claim(worker_id="collector", allowed_operations={"shell.execute"}) is None
    leased = await native.claim(
        worker_id="collector", allowed_operations={"agent_sources.validate"}
    )
    result = NativeOutcome(status="completed", result={"canonical": "/fixture"})
    with pytest.raises(NativeQueueError, match="receipt_conflict"):
        await native.complete(
            worker_id="unrelated",
            lease=leased,
            outcome=result,
            allowed_operations={"agent_sources.validate"},
        )
    for _ in range(2):
        assert await native.complete(
            worker_id="collector",
            lease=leased,
            outcome=result,
            allowed_operations={"agent_sources.validate"},
        )
    value = await native.get(owner=leased.owner_user_id, job_id=str(leased.job_id))
    assert value["result"] == result.result and value["revision"] == 2
    with pytest.raises(NativeQueueError, match="receipt_conflict"):
        await native.complete(
            worker_id="collector",
            lease=leased,
            outcome=NativeOutcome(status="completed", result={"different": True}),
            allowed_operations={"agent_sources.validate"},
        )


@pytest.mark.asyncio
async def test_expired_lease_is_unknown_and_never_reassigned_but_accepts_original_result(queue):
    native, clock = queue
    created = await enqueue(native)
    leased = await native.claim(
        worker_id="collector", allowed_operations={"agent_sources.validate"}
    )
    clock.now += timedelta(seconds=91)
    assert (await native.get(owner="a", job_id=created["id"]))["status"] == "unknown"
    assert (
        await native.claim(worker_id="new-worker", allowed_operations={"agent_sources.validate"})
        is None
    )
    forged = leased.model_copy(update={"lease_id": uuid4()})
    assert await native.heartbeat(worker_id="collector", lease=forged) is False
    with pytest.raises(NativeQueueError, match="receipt_conflict"):
        await native.complete(
            worker_id="collector",
            lease=forged,
            outcome=NativeOutcome(status="completed"),
            allowed_operations={"agent_sources.validate"},
        )
    assert await native.complete(
        worker_id="collector",
        lease=leased,
        outcome=NativeOutcome(status="completed", result={"late_receipt": True}),
        allowed_operations={"agent_sources.validate"},
    )
    assert (await native.get(owner="a", job_id=created["id"]))["status"] == "completed"


@pytest.mark.asyncio
async def test_concurrent_claims_have_one_winner_and_system_reads_do_not_allow_unscoped_writes(
    queue,
):
    native, _clock = queue
    await enqueue(native)
    winners = await asyncio.gather(
        *[
            native.claim(worker_id=worker, allowed_operations={"agent_sources.validate"})
            for worker in ("one", "two")
        ]
    )
    assert sum(item is not None for item in winners) == 1
    async with native.database.sessions(info={"allow_system_reads": True}) as session:
        assert len(list(await session.scalars(select(NativeJob)))) == 1
        with pytest.raises(ServiceStorageError, match="账号上下文"):
            await session.execute(update(NativeJob).values(status="queued"))
