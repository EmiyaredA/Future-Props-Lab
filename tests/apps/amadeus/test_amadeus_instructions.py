"""Instructions survive concurrency, cancellation and restart without replay."""

import asyncio
from dataclasses import replace
from datetime import timedelta

import pytest

from studio.apps.amadeus.storage.conversations import Conversations
from studio.apps.amadeus.storage.instructions import InstructionRecords
from studio.apps.amadeus.storage.migrations.registry import MIGRATIONS
from studio.apps.amadeus.storage.models import AmadeusMessage, AmadeusRun
from studio.apps.amadeus.storage.recovery import recover_runs
from studio.apps.amadeus.storage.runs import RunRecords
from studio.apps.amadeus.storage.service_models import MODELS
from studio.contracts.amadeus.conversations import InstructionCreate, RunCreateIn, RunEventIn
from studio.contracts.amadeus.instructions import InstructionReceipt
from studio.contracts.identity.principal import StudioPrincipal
from studio.runtime.database.migrations import apply
from studio.runtime.database.operation_receipts import OperationError
from studio.runtime.database.sessions import Database
from studio.runtime.time import utc_now


@pytest.fixture
async def owned_run(tmp_path):
    root = tmp_path / "amadeus"
    root.mkdir()
    # Exercise the upgrade from the previous registered schema as well as fresh creation.
    apply(root / "service.db", "amadeus", MIGRATIONS[:-1])
    apply(root / "service.db", "amadeus", MIGRATIONS)
    database = Database("amadeus", root, models=MODELS)
    principal = StudioPrincipal("fixture-owner", False, "session", frozenset())

    async def resolve(_agent):
        return "sealed-fixture"

    async with database.sessions(info={"owner_user_id": principal.user_id}) as session:
        conversation = await Conversations(session, principal).create()
        run = await RunRecords(session, principal, resolve_agent=resolve).create(
            conversation.id, RunCreateIn(agent_id="codex")
        )
        await InstructionRecords(session, principal).claim(
            conversation.id, run.run.id, "lease", True
        )
    try:
        yield database, principal, conversation.id, run.run.id
    finally:
        await database.close()


async def test_concurrent_idempotent_admission_and_exact_dispatch_receipt(owned_run):
    database, principal, conversation, run = owned_run
    body = InstructionCreate(request_id="one", expected_revision=0, text="改变方向")

    async def create():
        async with database.sessions(info={"owner_user_id": principal.user_id}) as session:
            return await InstructionRecords(session, principal).create(conversation, run, body)

    first, replay = await asyncio.gather(create(), create())
    assert first == replay
    async with database.sessions(info={"owner_user_id": principal.user_id}) as session:
        records = InstructionRecords(session, principal)
        with pytest.raises(OperationError, match="请求标识"):
            await records.create(conversation, run, body.model_copy(update={"text": "不同内容"}))
        await session.rollback()
        with pytest.raises(OperationError, match="暂不能"):
            await records.create(conversation, run, body.model_copy(update={"request_id": "two"}))
        await session.rollback()
        await RunRecords(session, principal).append_event(
            conversation,
            run,
            RunEventIn(
                kind="assistant_delta",
                payload={"text": "原响应"},
                idempotency_key="before",
            ),
        )
        claimed = await records.claim(conversation, run, "lease", True)
        assert claimed.request_id == "one" and "改变方向" in claimed.text
        assert await records.claim(conversation, run, "lease", True) is None
        receipt = InstructionReceipt(
            request_id="one",
            text_sha256=claimed.text_sha256,
            status="accepted",
        )
        with pytest.raises(OperationError, match="回执"):
            await records.settle(conversation, run, "other-lease", receipt)
        await records.settle(conversation, run, "lease", receipt)
        await records.settle(conversation, run, "lease", receipt)
        detail = await RunRecords(session, principal).detail(conversation, run)
        assert detail.instructions[0].status == "accepted" and detail.can_receive
        assert [x.kind for x in detail.events] == ["assistant_delta", "user_instruction"]
        assert detail.events[1].payload["message_id"] == first.message_id
        foreign = InstructionRecords(session, replace(principal, user_id="other-owner"))
        with pytest.raises(OperationError, match="不存在"):
            await foreign.create(conversation, run, body)


@pytest.mark.parametrize("dispatched", [False, True])
@pytest.mark.parametrize("restart", [False, True])
async def test_stop_and_restart_settle_without_redispatch(owned_run, dispatched, restart):
    database, principal, conversation, run = owned_run
    body = InstructionCreate(request_id="one", expected_revision=0, text="补充")
    async with database.sessions(info={"owner_user_id": principal.user_id}) as session:
        records = InstructionRecords(session, principal)
        saved = await records.create(conversation, run, body)
        claimed = await records.claim(conversation, run, "lease", True) if dispatched else None
        if restart:
            await recover_runs(session)
        else:
            await RunRecords(session, principal).mark_cancelling(conversation, run)
            await RunRecords(session, principal).finish(conversation, run, "cancelled", None)
        detail = await RunRecords(session, principal).detail(conversation, run)
        assert not detail.can_receive
        expected = "unknown" if dispatched else "rejected"
        assert detail.instructions[0].status == expected
        assert (await session.get(AmadeusMessage, saved.message_id)).status == expected
        assert await records.claim(conversation, run, "lease", True) is None
        assert (await records.create(conversation, run, body)).status == expected
        if claimed:
            await records.settle(
                conversation,
                run,
                "lease",
                InstructionReceipt(
                    request_id="one",
                    text_sha256=claimed.text_sha256,
                    status="accepted",
                ),
            )
            assert (await records.items(run))[0].status == "accepted"


async def test_expired_readiness_and_stale_revision_never_admit_input(owned_run):
    database, principal, conversation, run = owned_run
    body = InstructionCreate(request_id="one", expected_revision=0, text="补充")
    async with database.sessions(info={"owner_user_id": principal.user_id}) as session:
        row = await session.get(AmadeusRun, run)
        row.input_ready_at = utc_now() - timedelta(seconds=6)
        await session.commit()
        records = InstructionRecords(session, principal)
        with pytest.raises(OperationError, match="暂不能"):
            await records.create(conversation, run, body)
        await records.claim(conversation, run, "lease", True)
        from studio.runtime.revisions import RevisionConflictError

        with pytest.raises(RevisionConflictError):
            await records.create(
                conversation, run, body.model_copy(update={"expected_revision": 99})
            )
        await session.rollback()
        assert await records.items(run) == []
