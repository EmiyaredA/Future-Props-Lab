from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass

generation_semaphore = asyncio.Semaphore(4)
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RunnerHealth:
    name: str
    running: bool
    consecutive_failures: int
    last_error_type: str


class PollingGenerationRunner:
    """Single-process polling lifecycle shared by generation task adapters."""

    runner_name = "generation-runner"
    poll_interval_seconds = 5.0
    max_backoff_seconds = 60.0
    unhealthy_after_failures = 3

    def __init__(self) -> None:
        self._stop = asyncio.Event()
        self._task: asyncio.Task[None] | None = None
        self._consecutive_failures = 0
        self._last_error_type = ""

    async def recover(self) -> None:
        raise NotImplementedError

    async def process_once(self) -> None:
        raise NotImplementedError

    async def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        await self.recover()
        self._stop.clear()
        self._consecutive_failures = 0
        self._last_error_type = ""
        self._task = asyncio.create_task(self._run(), name=self.runner_name)

    async def stop(self) -> None:
        self._stop.set()
        if self._task is not None:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
            self._task = None

    @property
    def health(self) -> RunnerHealth:
        running = self._task is not None and not self._task.done()
        return RunnerHealth(
            name=self.runner_name,
            running=running,
            consecutive_failures=self._consecutive_failures,
            last_error_type=self._last_error_type,
        )

    @property
    def is_healthy(self) -> bool:
        health = self.health
        return health.running and health.consecutive_failures < self.unhealthy_after_failures

    async def _run(self) -> None:
        while not self._stop.is_set():
            delay = self.poll_interval_seconds
            try:
                await self.process_once()
                self._consecutive_failures = 0
                self._last_error_type = ""
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self._consecutive_failures += 1
                self._last_error_type = type(exc).__name__
                delay = min(
                    self.poll_interval_seconds * (2 ** min(self._consecutive_failures - 1, 8)),
                    self.max_backoff_seconds,
                )
                logger.error(
                    "%s poll failed (%s)",
                    self.runner_name,
                    self._last_error_type,
                )
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=delay)
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


class RunnerSupervisor:
    """Starts and stops polling runners as one application lifecycle unit."""

    def __init__(self, runners: Iterable[PollingGenerationRunner]) -> None:
        self.runners = tuple(runners)

    async def start(self) -> None:
        started: list[PollingGenerationRunner] = []
        try:
            for runner in self.runners:
                await runner.start()
                started.append(runner)
        except Exception:
            for runner in reversed(started):
                await runner.stop()
            raise

    async def stop(self) -> None:
        for runner in reversed(self.runners):
            await runner.stop()

    @property
    def is_healthy(self) -> bool:
        return bool(self.runners) and all(runner.is_healthy for runner in self.runners)

    @property
    def health(self) -> tuple[RunnerHealth, ...]:
        return tuple(runner.health for runner in self.runners)
