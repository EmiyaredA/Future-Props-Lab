"""Approval handles belong to a constructed application, never an imported module."""

import asyncio

import pytest

from studio.runtime.tasks.reactive_tools.approval import (
    ApprovalBroker,
    ApprovalNotFoundError,
)


async def pending(broker, *, run="run", proposal="proposal", scope=None):
    ready = asyncio.Event()

    async def registered():
        ready.set()

    waiter = asyncio.create_task(
        broker.wait(
            run_id=run,
            approval_id=proposal,
            scope=scope or {"owner": "alice"},
            proposal_canvas_revision=7,
            timeout_seconds=1,
            on_registered=registered,
        )
    )
    await asyncio.wait_for(ready.wait(), 1)
    return waiter


async def test_independent_approval_handles_and_shutdown_cannot_approve():
    first, second = ApprovalBroker(), ApprovalBroker()
    a = await pending(first)
    b = await pending(second)
    await first.close()
    with pytest.raises(asyncio.CancelledError):
        await a
    assert not b.done()
    with pytest.raises(ApprovalNotFoundError):
        await first.resolve(
            run_id="run",
            approval_id="proposal",
            scope={"owner": "alice"},
            decision="approve",
            canvas_revision=99,
        )
    with pytest.raises(RuntimeError, match="已关闭"):
        await first.wait(
            run_id="new",
            approval_id="new",
            scope={},
            proposal_canvas_revision=0,
            timeout_seconds=1,
        )
    await second.resolve(
        run_id="run",
        approval_id="proposal",
        scope={"owner": "alice"},
        decision="approve",
        canvas_revision=99,
    )
    assert (await b).canvas_revision == 7
    await second.close()


async def test_cancelled_run_does_not_cancel_another_run_and_scope_is_checked():
    broker = ApprovalBroker()
    a = await pending(broker, run="first")
    b = await pending(broker, run="second")
    try:
        with pytest.raises(ApprovalNotFoundError):
            await broker.resolve(
                run_id="second",
                approval_id="proposal",
                scope={"owner": "bob"},
                decision="approve",
                canvas_revision=7,
            )
        await broker.cancel_run("first")
        with pytest.raises(asyncio.CancelledError):
            await a
        assert not b.done()
        await broker.resolve(
            run_id="second",
            approval_id="proposal",
            scope={"owner": "alice"},
            decision="reject",
            canvas_revision=7,
            authorization="must-not-be-retained",
        )
        result = await b
        assert result.decision == "reject" and result.authorization is None
    finally:
        await broker.close()


async def test_expired_or_restarted_approval_is_not_recoverable_from_process_memory():
    broker = ApprovalBroker()
    with pytest.raises(TimeoutError):
        await broker.wait(
            run_id="run",
            approval_id="proposal",
            scope={"owner": "alice"},
            proposal_canvas_revision=7,
            timeout_seconds=0.001,
        )
    for current in (broker, ApprovalBroker()):
        with pytest.raises(ApprovalNotFoundError):
            await current.resolve(
                run_id="run",
                approval_id="proposal",
                scope={"owner": "alice"},
                decision="approve",
                canvas_revision=7,
            )
        await current.close()
