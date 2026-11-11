import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from studio.apps.amadeus.dialogue_tools import DialogueTools
from studio.apps.amadeus.execution.website_actions import ActionExecution
from studio.runtime.database.operation_receipts import OperationError


@pytest.mark.asyncio
async def test_dialogue_reads_and_write_proposals_use_separate_ports():
    records = SimpleNamespace(
        require_running=AsyncMock(),
        propose=AsyncMock(return_value=SimpleNamespace(model_dump=lambda **_: {"id": "approval"})),
    )
    files = SimpleNamespace(read=AsyncMock(return_value={"content": "hello"}))
    read = AsyncMock(return_value={"result": {"title": "项目"}})
    tools = DialogueTools(
        SimpleNamespace(mode="agent"),
        {},
        may_write=True,
        records=records,
        files=files,
        catalog=lambda _resource: [],
        operation_method=lambda operation, _args: "GET" if operation == "read" else "PATCH",
        read_operation=read,
    )
    assert (await tools.call("read_file", {"kind": "outputs", "name": "a.txt"})).result == {
        "content": "hello"
    }
    await tools.call("call", {"operation": "read", "arguments": {}})
    read.assert_awaited_once_with("read", {})
    proposal = await tools.call("call", {"operation": "edit", "arguments": {"revision": 2}})
    assert proposal.paused
    assert proposal.result == {"waiting_approval": {"id": "approval"}}
    records.propose.assert_awaited_once_with("fpl_operation:edit", {"revision": 2})
    records.require_running.side_effect = OperationError("run ended", "run_not_active", 409)
    with pytest.raises(OperationError, match="run ended"):
        await tools.call("read_file", {"kind": "outputs", "name": "a.txt"})
    files.read.assert_awaited_once()


@pytest.mark.asyncio
async def test_shutdown_during_claim_waits_for_settlement_without_starting_effect():
    execution = ActionExecution()
    claiming, release_claim = asyncio.Event(), asyncio.Event()

    async def claim(_id):
        claiming.set()
        await release_claim.wait()
        return SimpleNamespace(tool_name="mcp:provider:tool", arguments={})

    settle = AsyncMock()
    records = SimpleNamespace(claim=claim, settle=settle)
    effect = AsyncMock()
    scope = ("owner", "conversation")
    action = asyncio.create_task(execution.execute(scope, "action", records, effect))
    await asyncio.wait_for(claiming.wait(), 1)
    with pytest.raises(OperationError, match="操作已经开始"):
        await execution.execute(scope, "action", records, effect)
    shutdown = asyncio.create_task(execution.close())
    await asyncio.sleep(0)
    assert not shutdown.done()
    release_claim.set()
    await asyncio.wait_for(shutdown, 1)
    assert action.cancelled()
    effect.assert_not_awaited()
    settle.assert_awaited_once_with(
        "action", "unknown", {"message": "执行中断；请检查外部服务实际状态"}
    )
