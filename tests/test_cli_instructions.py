import asyncio
import json
from types import SimpleNamespace

import pytest

from app.capabilities.agents.cli.conversation import codex_turn
from app.capabilities.agents.cli.instructions import LiveInstructions
from app.capabilities.agents.cli.native import pi


async def no_event(*_args):
    pass


@pytest.mark.parametrize("status", ["accepted", "rejected", "unknown"])
async def test_codex_targets_native_turn_and_waits_for_ack_while_tool_is_pending(status):
    messages = asyncio.StreamReader()
    tool_called = asyncio.Event()
    finish_tool = asyncio.Event()
    policy = {
        "sandbox_mode": "read-only",
        "approval_policy": "never",
        "web_search": "disabled",
        "cli_auth_credentials_store": "file",
        "features": {
            "skip_host_skill_discovery": True,
            **dict.fromkeys(
                ("shell_tool", "hooks", "plugins", "apps", "multi_agent", "skill_search"), False
            ),
        },
    }

    def respond(message):
        messages.feed_data(json.dumps(message).encode() + b"\n")

    async def call(name, args):
        assert name == "read_file" and args == {"path": "sample"}
        tool_called.set()
        await finish_tool.wait()
        return "done"

    def write(raw):
        message = json.loads(raw)
        method = message.get("method")
        if method == "initialized":
            return
        if method == "turn/steer":
            assert message["params"] == {
                "threadId": "thread",
                "expectedTurnId": "native",
                "input": [{"type": "text", "text": "new requirement"}],
            }
            if status == "accepted":
                respond({"id": message["id"], "result": {"turnId": "native"}})
            elif status == "rejected":
                respond({"id": message["id"], "error": {"code": -32602}})
            else:
                respond({"method": "turn/completed", "params": {"turn": {"status": "completed"}}})
            return
        if message["id"] == "tool":
            respond({"method": "turn/completed", "params": {"turn": {"status": "completed"}}})
            return
        results = {
            "initialize": {},
            "config/read": {"config": policy},
            "thread/start": {"thread": {"id": "thread"}},
            "turn/start": {"turn": {"id": "native"}},
        }
        respond({"id": message["id"], "result": results[method]})
        if method == "turn/start":
            respond(
                {
                    "id": "tool",
                    "method": "item/tool/call",
                    "params": {
                        "tool": "read_file",
                        "arguments": {"path": "sample"},
                    },
                }
            )

    instructions = LiveInstructions()
    process = SimpleNamespace(stdout=messages, stdin=SimpleNamespace(write=write, drain=no_event))
    async with asyncio.timeout(3):
        run = asyncio.create_task(
            codex_turn(process, {}, "prompt", [], call, no_event, instructions)
        )
        try:
            await tool_called.wait()
            assert instructions.ready
            assert await instructions.submit("steer:1", "new requirement") == status
            finish_tool.set()
            await run
        finally:
            run.cancel()
            await asyncio.gather(run, return_exceptions=True)
    assert not instructions.ready
    assert await instructions.submit("steer:late", "too late") == "rejected"


@pytest.mark.parametrize("disposition,status", [("queued", "accepted"), ("handled", "rejected")])
async def test_pi_acknowledges_native_steering_without_starting_another_prompt(disposition, status):
    messages = asyncio.Queue()
    ready = asyncio.Event()

    async def send(message):
        if message["type"] == "prompt":
            await messages.put(
                {
                    "type": "response",
                    "id": message["id"],
                    "command": "prompt",
                    "success": True,
                    "data": {"disposition": "started"},
                }
            )
            await messages.put(
                {
                    "type": "message_update",
                    "assistantMessageEvent": {
                        "type": "text_delta",
                        "delta": "response",
                    },
                }
            )
        else:
            assert message == {"id": "steer:2", "type": "steer", "message": "change direction"}
            await messages.put(
                {
                    "type": "response",
                    "id": message["id"],
                    "command": "steer",
                    "success": True,
                    "data": {"disposition": disposition},
                }
            )
            await messages.put({"type": "agent_settled"})

    async def emit(*_args):
        ready.set()

    instructions = LiveInstructions()
    async with asyncio.timeout(3):
        run = asyncio.create_task(
            pi(SimpleNamespace(send=send, read=messages.get), "prompt", emit, instructions)
        )
        try:
            await ready.wait()
            assert await instructions.submit("steer:2", "change direction") == status
            assert await run == "response"
        finally:
            run.cancel()
            await asyncio.gather(run, return_exceptions=True)
    assert not instructions.ready
