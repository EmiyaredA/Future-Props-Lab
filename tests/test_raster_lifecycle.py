"""Preview concurrency belongs to an application and survives repeated cancellation."""

import asyncio
import threading

import pytest

from studio.runtime.files import raster


async def test_decoder_slot_is_not_released_early_or_shared_with_another_instance(
    tmp_path, monkeypatch
):
    loop = asyncio.get_running_loop()
    entered, release = asyncio.Event(), threading.Event()
    first, second = raster.RasterPreviews(1), raster.RasterPreviews(1)

    def render(source, target, _size):
        if source.name == "slow":
            loop.call_soon_threadsafe(entered.set)
            assert release.wait(5)
        target.write_bytes(b"complete")

    monkeypatch.setattr(raster, "_render", render)
    running = asyncio.create_task(first.render(tmp_path / "slow", tmp_path / "a", 128))
    queued = None
    try:
        await asyncio.wait_for(entered.wait(), 5)
        for _ in range(2):
            running.cancel()
            await asyncio.sleep(0)
        queued = asyncio.create_task(first.render(tmp_path / "fast", tmp_path / "b", 128))
        await asyncio.wait_for(second.render(tmp_path / "fast", tmp_path / "c", 128), 5)
        assert not running.done()
        assert not queued.done()
        assert not (tmp_path / "b").exists()
        assert (tmp_path / "c").read_bytes() == b"complete"
    finally:
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await running
        if queued is not None:
            await queued
    assert (tmp_path / "a").read_bytes() == (tmp_path / "b").read_bytes() == b"complete"
