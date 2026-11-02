import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from starlette.websockets import WebSocketDisconnect

from app.llm.realtime import session as realtime


@pytest.mark.asyncio
@pytest.mark.parametrize("trigger", ["watchdog", "commit_input"])
async def test_realtime_downgrade_closes_provider_before_another_call(monkeypatch, trigger):
    calls = 0
    receives = 0

    async def check_access():
        nonlocal calls
        calls += 1
        if calls > 1:
            raise WebSocketDisconnect(4403)

    async def receive_json():
        nonlocal receives
        receives += 1
        if receives == 1:
            return {"type": "start", "model_id": "deterministic"}
        if receives == 2 and trigger == "commit_input":
            return {"type": "commit_input", "turn_id": "forbidden"}
        await asyncio.Future()

    bridge = SimpleNamespace(
        outbound=asyncio.Queue(),
        start=AsyncMock(),
        close=AsyncMock(),
        commit_input=Mock(),
        session_id="test-provider",
    )
    monkeypatch.setattr(realtime, "PERMISSION_RECHECK_SECONDS", 0.01)
    monkeypatch.setattr(realtime, "SenseAudioRealtimeBridge", Mock(return_value=bridge))
    monkeypatch.setattr(
        realtime, "resolve_realtime_model", AsyncMock(return_value=SimpleNamespace(slug="test"))
    )
    socket = SimpleNamespace(receive_json=receive_json, send_json=AsyncMock())
    await asyncio.wait_for(
        realtime.run_realtime_model_test(
            socket, owner_user_id="test-user", check_access=check_access
        ),
        timeout=2,
    )
    assert calls == 2
    bridge.start.assert_awaited_once()
    bridge.close.assert_awaited_once()
    bridge.commit_input.assert_not_called()
    assert not any(task.get_name().startswith("realtime-") for task in asyncio.all_tasks())
