"""Both website assemblies use isolated demo execution state, with drain semantics."""

import asyncio

import pytest

from studio.apps.model_service.demonstration.execution import DEFAULT_CONFIG, DemoRuntime


async def test_demo_instances_do_not_share_calls_logs_or_draining():
    async def configuration(_service):
        return {**DEFAULT_CONFIG, "enabled": True}

    first, second = DemoRuntime(configuration), DemoRuntime(configuration)
    entered = asyncio.Event()

    async def pending():
        async with first.invocation("mock_model"):
            entered.set()
            await asyncio.Event().wait()

    call = asyncio.create_task(pending())
    await entered.wait()
    draining = asyncio.create_task(first.reinitialize("mock_model"))
    try:
        await asyncio.sleep(0)
        assert not draining.done()
        assert (await first.status("mock_model"))["state"] == "reinitializing"
        assert (await second.status("mock_model"))["active_calls"] == 0
        result = await second.completion({})
        assert result["choices"][0]["message"]["content"] == DEFAULT_CONFIG["response_text"]
        assert not (await first.status("mock_model"))["logs"]
        assert len((await second.status("mock_model"))["logs"]) == 1
        call.cancel()
        with pytest.raises(asyncio.CancelledError):
            await call
        await asyncio.wait_for(draining, 1)
        assert (await first.status("mock_model"))["active_calls"] == 0
        assert (await first.status("mock_model"))["state"] == "running"
    finally:
        call.cancel()
        draining.cancel()
        await asyncio.gather(call, draining, return_exceptions=True)
