"""Cancellation cannot release an I/O borrow while its worker still writes."""

import asyncio
import threading

import pytest

from studio.runtime.tasks.blocking_io import run_blocking_io


@pytest.mark.parametrize("fail", [False, True])
async def test_repeated_cancellation_waits_for_worker_and_consumes_late_error(tmp_path, fail):
    started, release = asyncio.Event(), threading.Event()
    loop = asyncio.get_running_loop()
    output = tmp_path / "borrowed"

    def write():
        loop.call_soon_threadsafe(started.set)
        assert release.wait(5), "test did not release worker"
        output.write_text("finished")
        if fail:
            raise OSError("late failure")

    task = asyncio.create_task(run_blocking_io(write))
    try:
        await asyncio.wait_for(started.wait(), 5)
        for _ in range(2):
            task.cancel()
            await asyncio.sleep(0)
            assert not task.done()
            assert not output.exists()
    finally:
        release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert output.read_text() == "finished"


async def test_completed_io_preserves_result_and_error():
    assert await run_blocking_io(lambda value: value + 1, 4) == 5

    def fail():
        raise OSError("copy failed")

    with pytest.raises(OSError, match="copy failed"):
        await run_blocking_io(fail)
