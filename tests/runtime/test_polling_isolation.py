"""Runner concurrency belongs to an application lifecycle, including failure cleanup."""

import asyncio

import pytest

from studio.runtime.tasks.polling import PollingTaskRunner


def test_contended_runner_does_not_bind_a_new_instance_to_its_event_loop():
    async def contend():
        runner = PollingTaskRunner()
        active, maximum = 0, 0

        async def handler(_identity):
            nonlocal active, maximum
            active += 1
            maximum = max(maximum, active)
            await asyncio.sleep(0)
            active -= 1

        await runner.run_concurrently(map(str, range(9)), handler)
        assert maximum == 4

    asyncio.run(contend())
    asyncio.run(contend())


async def test_failed_poll_waits_for_sibling_cleanup():
    started, cleaned = asyncio.Event(), asyncio.Event()
    runner = PollingTaskRunner()

    async def handler(identity):
        if identity == "fail":
            await started.wait()
            raise ValueError("failed task")
        try:
            started.set()
            await asyncio.Event().wait()
        finally:
            await asyncio.sleep(0)
            cleaned.set()

    with pytest.raises(ValueError, match="failed task"):
        await runner.run_concurrently(["fail", "sibling"], handler)
    assert cleaned.is_set()


async def test_cancelled_poll_releases_an_explicit_shared_limit():
    limit = asyncio.Semaphore(1)
    started, cleaned = asyncio.Event(), asyncio.Event()

    async def handler(_identity):
        try:
            started.set()
            await asyncio.Event().wait()
        finally:
            await asyncio.sleep(0)
            cleaned.set()

    task = asyncio.create_task(
        PollingTaskRunner(concurrency=limit).run_concurrently(["a", "b"], handler)
    )
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert cleaned.is_set()
    await asyncio.wait_for(limit.acquire(), timeout=1)
    limit.release()


@pytest.mark.parametrize("initial_failure", [False, True])
async def test_repeated_cancellation_waits_for_cleanup_and_takes_precedence(initial_failure):
    started, cleanup_started, allow_cleanup = asyncio.Event(), asyncio.Event(), asyncio.Event()
    cleaned = False
    limit = asyncio.Semaphore(2)

    async def handler(identity):
        nonlocal cleaned
        if identity == "failure":
            await started.wait()
            raise ValueError("initial failure")
        try:
            started.set()
            await asyncio.Event().wait()
        finally:
            cleanup_started.set()
            await allow_cleanup.wait()
            cleaned = True

    runner = PollingTaskRunner(concurrency=limit)
    identities = ["failure", "worker"] if initial_failure else ["worker"]
    task = asyncio.create_task(runner.run_concurrently(identities, handler))
    try:
        if not initial_failure:
            await started.wait()
            task.cancel()
        await cleanup_started.wait()
        task.cancel()
        await asyncio.sleep(0)
        assert not task.done()
        assert not cleaned
        allow_cleanup.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert cleaned
        await asyncio.wait_for(limit.acquire(), timeout=1)
        await asyncio.wait_for(limit.acquire(), timeout=1)
        limit.release()
        limit.release()
    finally:
        allow_cleanup.set()
        await asyncio.gather(task, return_exceptions=True)
