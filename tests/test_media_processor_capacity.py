"""Preview work is bounded by each assembled processor, including cancellation."""

import asyncio
from contextlib import ExitStack
from types import SimpleNamespace

import pytest

from studio.apps.media_rendering import previews as preview_module
from studio.apps.media_rendering.previews import MediaPreviews
from studio.apps.media_rendering.processing import LocalMediaProcessor
from studio.contracts.asset_library.media_content import MediaDescription
from studio.runtime.files.borrowed_media import FileMediaContent


@pytest.mark.asyncio
async def test_processors_do_not_share_capacity_and_release_cancelled_slots(tmp_path, monkeypatch):
    started = asyncio.Queue()
    release = asyncio.Event()

    async def inspect(settings, info, path):
        await started.put((settings.name, info.id))
        await release.wait()
        return path.read_bytes()

    monkeypatch.setattr(preview_module, "describe_preview", inspect)
    processors = [
        LocalMediaProcessor(
            MediaPreviews(SimpleNamespace(name=name)), root=tmp_path / name, maximum=100
        )
        for name in ("first", "second")
    ]
    path = tmp_path / "source.txt"
    path.write_bytes(b"private")
    tasks = []
    with ExitStack() as stack:
        sources = [
            stack.enter_context(
                FileMediaContent(
                    MediaDescription(str(i), 1, "owner", "text", "text/plain", "x"), path
                )
            )
            for i in range(4)
        ]
        try:
            for source in sources[:2]:
                tasks.append(asyncio.create_task(processors[0].metadata(source)))
            assert {await asyncio.wait_for(started.get(), 1) for _ in range(2)} == {
                ("first", "0"),
                ("first", "1"),
            }
            tasks.append(asyncio.create_task(processors[0].metadata(sources[2])))
            tasks.append(asyncio.create_task(processors[1].metadata(sources[3])))
            # The second instance runs while both first-instance slots are occupied.
            assert await asyncio.wait_for(started.get(), 1) == ("second", "3")
            assert started.empty()
            tasks[0].cancel()
            with pytest.raises(asyncio.CancelledError):
                await tasks[0]
            assert await asyncio.wait_for(started.get(), 1) == ("first", "2")
            release.set()
            assert await asyncio.gather(*tasks[1:]) == [b"private"] * 3
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
