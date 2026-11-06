"""One receipt contract for memory and SQLite, including ambiguous commit recovery."""

import asyncio
from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import timedelta
from uuid import uuid4

import pytest

from studio.apps.agent_workbench.execution.models import WorkbenchChat, WorkbenchTurn
from studio.apps.agent_workbench.rules.turn_endings import closed_approvals, closed_inflight
from studio.apps.agent_workbench.storage.service_models import WorkbenchExecutionJob
from studio.apps.agent_workbench.storage.turn_settlement import SqlTurnSettlement
from studio.apps.agent_workbench.use_cases.settle_turn import (
    ReceiptError,
    ReceiptState,
    SettleTurn,
    canonical,
    decide,
)
from studio.contracts.agent_workbench.execution import RUN_TURN, TurnScope
from studio.contracts.agent_workbench.native import NativeLease, NativeOutcome
from studio.runtime.tasks.native_queue import digest
from studio.runtime.time import utc_now
from tests.apps.agent_workbench.archive_database import open_archive


class MemorySettlement:
    def __init__(self, lease, turn_status):
        self.owner = lease.owner_user_id
        self.current = ReceiptState(
            "worker",
            str(lease.lease_id),
            RUN_TURN,
            canonical(lease.payload),
            None,
            "leased",
            turn_status,
        )
        self.paused = False
        self.revision = 1
        self.failure = None
        self.lock = asyncio.Lock()

    async def commit_receipt(self, receipt):
        async with self.lock:
            result = decide(receipt, self.current if receipt.owner == self.owner else None)
            failure, self.failure = self.failure, None
            if failure == "before":
                raise RuntimeError("commit interrupted")
            if not result.duplicate:
                self.current = replace(
                    self.current, checksum=receipt.checksum, job_status=receipt.status
                )
                if result.ending:
                    self.current = replace(self.current, turn_status=result.ending.status)
                    self.paused |= result.ending.status != "completed"
                    self.revision += 1
            if failure == "after":
                raise RuntimeError("commit acknowledgement lost")
            return result

    async def snapshot(self):
        return (
            self.current.job_status,
            self.current.turn_status,
            self.current.checksum,
            self.paused,
            self.revision,
        )


class SqlHarness:
    def __init__(self, database, lease):
        self.database, self.lease = database, lease
        self.failure = None
        self.store = SqlTurnSettlement(self.sessions)

    @asynccontextmanager
    async def sessions(self, **kwargs):
        async with self.database.sessions(**kwargs) as db:
            commit = db.commit

            async def interrupted_commit():
                failure, self.failure = self.failure, None
                if failure == "before":
                    raise RuntimeError("commit interrupted")
                await commit()
                if failure == "after":
                    raise RuntimeError("commit acknowledgement lost")

            db.commit = interrupted_commit
            yield db

    async def commit_receipt(self, receipt):
        return await self.store.commit_receipt(receipt)

    async def snapshot(self):
        async with self.database.sessions(info={"owner_user_id": "alice"}) as db:
            job = await db.get(WorkbenchExecutionJob, str(self.lease.job_id))
            turn = await db.get(WorkbenchTurn, "turn")
            chat = await db.get(WorkbenchChat, "chat")
            return job.status, turn.status, job.outcome_sha256, chat.queue_paused, turn.revision


@pytest.fixture(params=["memory", "sqlite"])
async def receipt_store(request, tmp_path, monkeypatch):
    lease = NativeLease(
        job_id=uuid4(),
        lease_id=uuid4(),
        owner_user_id="alice",
        operation=RUN_TURN,
        payload=TurnScope(
            project_id="project", agent="codex", local=False, chat_id="chat", turn_id="turn"
        ).model_dump(mode="json"),
        # Expiry blocks execution, but an exact late receipt can reconcile it.
        lease_expires_at=(utc_now() - timedelta(seconds=10)).isoformat(),
    )
    if request.param == "memory":
        yield MemorySettlement(lease, "running"), lease
        return
    database = open_archive(tmp_path, monkeypatch)
    try:
        async with database.sessions(info={"owner_user_id": "alice"}) as db:
            db.add(
                WorkbenchChat(
                    id="chat",
                    owner_user_id="alice",
                    project_id="project",
                    agent_id="codex",
                    created_at=1,
                )
            )
            await db.flush()
            db.add(
                WorkbenchTurn(
                    id="turn",
                    owner_user_id="alice",
                    chat_id="chat",
                    client_id="request",
                    position=1,
                    prompt="message",
                    answer="",
                    status="running",
                    error=None,
                    approvals=[{"id": "approval", "status": "executing"}],
                    instructions=[{"status": "sending"}],
                    activity=[{"status": "running"}],
                    revision=1,
                )
            )
            db.add(
                WorkbenchExecutionJob(
                    id=str(lease.job_id),
                    owner_user_id="alice",
                    request_id="request",
                    operation=RUN_TURN,
                    payload=lease.payload,
                    payload_sha256=digest(lease.payload),
                    status="leased",
                    worker_id="worker",
                    lease_id=str(lease.lease_id),
                    lease_expires_at=utc_now() - timedelta(seconds=10),
                )
            )
            await db.commit()
        yield SqlHarness(database, lease), lease
    finally:
        await database.close()


@pytest.mark.parametrize(
    "status,expected,paused",
    [
        ("completed", "completed", False),
        ("unknown", "interrupted", True),
        ("failed", "failed", True),
    ],
)
async def test_receipt_replay_is_atomic_and_expired_attempt_can_reconcile(
    receipt_store, status, expected, paused
):
    store, lease = receipt_store
    use_case = SettleTurn(store)
    outcome = NativeOutcome(status=status)
    result = await use_case.execute("worker", lease, outcome)
    assert result.ending.status == expected and not result.duplicate
    snapshot = await store.snapshot()
    assert snapshot == (status, expected, digest(outcome.model_dump(mode="json")), paused, 2)
    assert (await use_case.execute("worker", lease, outcome)).duplicate
    assert await store.snapshot() == snapshot
    with pytest.raises(ReceiptError, match="receipt_conflict"):
        await use_case.execute("worker", lease, outcome.model_copy(update={"message": "changed"}))
    assert await store.snapshot() == snapshot


@pytest.mark.parametrize("change", ["owner", "worker", "lease", "payload"])
async def test_receipt_cannot_cross_account_attempt_or_scope(receipt_store, change):
    store, lease = receipt_store
    worker = "worker"
    if change == "owner":
        lease = lease.model_copy(update={"owner_user_id": "bob"})
    elif change == "worker":
        worker = "other-worker"
    elif change == "lease":
        lease = lease.model_copy(update={"lease_id": uuid4()})
    else:
        lease = lease.model_copy(update={"payload": {**lease.payload, "project_id": "changed"}})
    before = await store.snapshot()
    with pytest.raises(ReceiptError, match="lease_ended"):
        await SettleTurn(store).execute(worker, lease, NativeOutcome(status="completed"))
    assert await store.snapshot() == before


@pytest.mark.parametrize("failure", ["before", "after"])
async def test_receipt_failure_rolls_back_or_reconciles_without_new_execution(
    receipt_store, failure
):
    store, lease = receipt_store
    store.failure = failure
    outcome = NativeOutcome(status="failed", error_code="test_failure")
    with pytest.raises(RuntimeError, match="commit"):
        await SettleTurn(store).execute("worker", lease, outcome)
    before_retry = await store.snapshot()
    assert before_retry[0] == ("leased" if failure == "before" else "failed")
    # Retry the same evidence, never the external action.
    result = await SettleTurn(store).execute("worker", lease, outcome)
    assert result.duplicate == (failure == "after")
    assert (await store.snapshot())[1:] == (
        "failed",
        digest(outcome.model_dump(mode="json")),
        True,
        2,
    )


async def test_competing_receipts_have_only_one_committed_winner(receipt_store):
    store, lease = receipt_store
    use_case = SettleTurn(store)
    results = await asyncio.gather(
        *(
            use_case.execute("worker", lease, NativeOutcome(status=status))
            for status in ("completed", "failed")
        ),
        return_exceptions=True,
    )
    assert sum(isinstance(result, ReceiptError) for result in results) == 1
    assert (await store.snapshot())[4] == 2


@pytest.mark.parametrize(
    "previous,expected", [("cancelling", "cancelled"), ("interrupted", "interrupted")]
)
async def test_cancel_and_recovered_turns_cannot_be_revived_by_late_receipts(
    receipt_store, previous, expected
):
    store, lease = receipt_store
    if isinstance(store, MemorySettlement):
        store.current = replace(store.current, turn_status=previous, job_status="unknown")
    else:
        async with store.database.sessions(info={"owner_user_id": "alice"}) as db:
            (await db.get(WorkbenchTurn, "turn")).status = previous
            (await db.get(WorkbenchExecutionJob, str(lease.job_id))).status = "unknown"
            await db.commit()
    await SettleTurn(store).execute("worker", lease, NativeOutcome(status="completed"))
    snapshot = await store.snapshot()
    assert snapshot[0:2] == ("completed", expected)
    assert snapshot[4] == (2 if previous == "cancelling" else 1)


def test_terminal_action_resolution_does_not_mutate_input_or_invent_success():
    approvals = [{"status": status} for status in ("executing", "pending", "approved", "completed")]
    assert [x["status"] for x in closed_approvals(approvals)] == [
        "unknown",
        "expired",
        "expired",
        "completed",
    ]
    assert approvals[0]["status"] == "executing"
    for active in ("sending", "running"):
        assert closed_inflight([{"status": active}], active) == [{"status": "unknown"}]
