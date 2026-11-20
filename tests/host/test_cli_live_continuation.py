"""Native response boundaries, rather than a timeout, authorize continuation."""

import asyncio
import json
from types import SimpleNamespace

import pytest

from studio.host.agent_execution.cli.instructions import LiveInstructions
from studio.host.agent_execution.cli.live_acp import live_acp
from studio.host.agent_execution.cli.live_claude import live_claude
from studio.host.agent_execution.cli.transport import CliError


@pytest.mark.parametrize("reason", ["cancelled", "end_turn", "max_tokens", "lost"])
async def test_acp_waits_for_exact_prompt_settlement_before_continuing(reason):
    incoming = asyncio.Queue()
    started = asyncio.Event()
    sent = []
    protocol = SimpleNamespace(sequence=0, read=incoming.get)

    async def send(value):
        sent.append(value)
        if value["method"] == "session/prompt":
            assert value["params"]["sessionId"] == "same-session"
            if value["id"] == 1:
                started.set()
            else:
                assert value["params"]["prompt"] == [{"type": "text", "text": "补充"}]
                await incoming.put(
                    {"jsonrpc": "2.0", "id": value["id"], "result": {"stopReason": "end_turn"}}
                )
        elif value["method"] == "session/cancel":
            assert len([x for x in sent if x["method"] == "session/prompt"]) == 1
            await incoming.put(
                None
                if reason == "lost"
                else {"jsonrpc": "2.0", "id": 1, "result": {"stopReason": reason}}
            )

    protocol.send = send
    instructions = LiveInstructions()

    async def event(_value):
        pass

    async with asyncio.timeout(3):
        run = asyncio.create_task(
            live_acp(protocol, "same-session", "original", event, instructions)
        )
        await started.wait()
        outcome = await instructions.submit("one", "补充")
        if reason in {"cancelled", "end_turn"}:
            await run
            assert outcome == "accepted"
            assert len([x for x in sent if x["method"] == "session/prompt"]) == 2
        else:
            with pytest.raises(CliError):
                await run
            assert outcome == "unknown"
            assert len([x for x in sent if x["method"] == "session/prompt"]) == 1
    assert not instructions.ready


async def test_claude_keeps_stdin_open_and_waits_for_interrupted_result():
    incoming = asyncio.StreamReader()
    started = asyncio.Event()
    messages = []
    sent = []

    def receive(value):
        incoming.feed_data(json.dumps(value).encode() + b"\n")

    def write(raw):
        value = json.loads(raw)
        sent.append(value)
        if value["type"] == "user":
            if len([x for x in sent if x["type"] == "user"]) == 1:
                receive({"type": "system", "subtype": "init"})
                receive(
                    {
                        "type": "stream_event",
                        "event": {"delta": {"type": "text_delta", "text": "原回复"}},
                    }
                )
            else:
                assert value["message"]["content"] == "补充"
                receive(value)
                receive(
                    {
                        "type": "stream_event",
                        "event": {"delta": {"type": "text_delta", "text": "接续回复"}},
                    }
                )
                receive({"type": "result", "subtype": "success", "usage": {"output_tokens": 3}})
        else:
            assert value["request"]["subtype"] == "interrupt"
            assert len([x for x in sent if x["type"] == "user"]) == 1
            receive(
                {
                    "type": "result",
                    "subtype": "error_during_execution",
                    "is_error": True,
                    "usage": {"output_tokens": 2},
                }
            )

    async def drain():
        pass

    async def emit(kind, payload):
        messages.append((kind, payload))
        started.set()

    process = SimpleNamespace(stdout=incoming, stdin=SimpleNamespace(write=write, drain=drain))
    instructions = LiveInstructions()
    async with asyncio.timeout(3):
        run = asyncio.create_task(live_claude(process, "original", emit, instructions))
        await started.wait()
        assert await instructions.submit("one", "补充") == "accepted"
        await run
    assert not instructions.ready
    assert [value["text"] for kind, value in messages if kind == "assistant_delta"] == [
        "原回复",
        "接续回复",
    ]
    assert messages[-1] == ("run_usage", {"output_tokens": 5})


@pytest.mark.parametrize("phase", ["flush", "claim"])
async def test_instruction_shutdown_waits_for_owned_transaction_after_repeated_cancel(phase):
    from studio.host.agent_execution.cli.instruction_delivery import deliver_instructions

    entered, release, committed = asyncio.Event(), asyncio.Event(), asyncio.Event()

    async def owned():
        entered.set()
        await release.wait()
        committed.set()

    async def flush():
        if phase == "flush":
            await owned()

    async def claim(_ready):
        if phase == "claim":
            await owned()

    async def settle(_receipt):
        raise AssertionError("Cancelled claim must not dispatch a model instruction")

    task = asyncio.create_task(deliver_instructions(LiveInstructions(), claim, settle, flush))
    await entered.wait()
    task.cancel()
    await asyncio.sleep(0)
    task.cancel()
    await asyncio.sleep(0)
    assert not task.done()
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert committed.is_set()
