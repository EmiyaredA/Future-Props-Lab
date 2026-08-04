from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Iterable

generation_semaphore = asyncio.Semaphore(4)


class PollingGenerationRunner:
    """Single-process polling lifecycle shared by generation task adapters."""

    runner_name = "generation-runner"
    poll_interval_seconds = 5.0

    def __init__(self) -> None:
        self._stop = asyncio.Event()
        self._task: asyncio.Task[None] | None = None

    async def recover(self) -> None:
        raise NotImplementedError

    async def process_once(self) -> None:
        raise NotImplementedError

    async def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        await self.recover()
        self._stop.clear()
        self._task = asyncio.create_task(self._run(), name=self.runner_name)

    async def stop(self) -> None:
        self._stop.set()
        if self._task is not None:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
            self._task = None

    async def _run(self) -> None:
        while not self._stop.is_set():
            await self.process_once()
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self.poll_interval_seconds)
            except TimeoutError:
                pass

    async def run_concurrently(
        self,
        task_ids: Iterable[str],
        handler: Callable[[str], Awaitable[None]],
    ) -> None:
        async def guarded(task_id: str) -> None:
            async with generation_semaphore:
                await handler(task_id)

        await asyncio.gather(*(guarded(task_id) for task_id in task_ids))
