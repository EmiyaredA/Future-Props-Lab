from __future__ import annotations

import asyncio

import pytest

from app.llm.generation_runtime import PollingGenerationRunner, RunnerSupervisor


class ScriptedRunner(PollingGenerationRunner):
    poll_interval_seconds = 0.001
    max_backoff_seconds = 0.002

    def __init__(self, failures: int = 0, *, fail_recovery: bool = False) -> None:
        super().__init__()
        self.failures = failures
        self.fail_recovery = fail_recovery
        self.calls = 0
        self.success = asyncio.Event()

    async def recover(self) -> None:
        if self.fail_recovery:
            raise RuntimeError("private recovery detail")

    async def process_once(self) -> None:
        self.calls += 1
        if self.calls <= self.failures:
            raise RuntimeError("private provider detail")
        self.success.set()


@pytest.mark.asyncio
async def test_runner_survives_failures_and_recovers_health() -> None:
    runner = ScriptedRunner(failures=3)
    await runner.start()
    try:
        while runner.calls < 3:
            await asyncio.sleep(0)
        assert runner.health.last_error_type == "RuntimeError"
        assert runner.health.consecutive_failures == 3
        assert runner.is_healthy is False
        await asyncio.wait_for(runner.success.wait(), timeout=1)
        assert runner.is_healthy is True
        assert runner.health.consecutive_failures == 0
    finally:
        await runner.stop()
    assert runner.health.running is False


@pytest.mark.asyncio
async def test_supervisor_stops_started_runners_when_startup_fails() -> None:
    first = ScriptedRunner()
    second = ScriptedRunner(fail_recovery=True)
    supervisor = RunnerSupervisor((first, second))

    with pytest.raises(RuntimeError, match="private recovery detail"):
        await supervisor.start()

    assert first.health.running is False
    assert second.health.running is False
