"""Cancel and continue prompts in the same restricted ACP session."""

from .transport import CliError


async def live_acp(protocol, session_id, prompt, event, instructions):
    replacement = None
    awaiting = None

    async def start(text):
        protocol.sequence += 1
        identity = protocol.sequence
        await protocol.send(
            {
                "jsonrpc": "2.0",
                "id": identity,
                "method": "session/prompt",
                "params": {"sessionId": session_id, "prompt": [{"type": "text", "text": text}]},
            }
        )
        return identity

    async def steer(identity, text):
        nonlocal replacement
        if replacement is not None:
            instructions.acknowledge(identity, "rejected")
            return
        replacement = identity, text
        await protocol.send(
            {
                "jsonrpc": "2.0",
                "method": "session/cancel",
                "params": {"sessionId": session_id},
            }
        )

    request_id = await start(prompt)
    instructions.send = steer
    try:
        while value := await protocol.read():
            if value.get("id") == request_id and "method" not in value:
                result = value.get("result", {})
                reason = result.get("stopReason")
                if "error" in value or reason not in {"cancelled", "end_turn"}:
                    if awaiting:
                        instructions.acknowledge(awaiting, "rejected")
                    raise CliError("ACP 未确认当前响应结束，未自动续接补充消息")
                if awaiting:
                    instructions.acknowledge(awaiting, "accepted")
                    awaiting = None
                if replacement is None:
                    if reason != "end_turn":
                        raise CliError("ACP 当前响应已中断")
                    return
                awaiting, text = replacement
                replacement = None
                # The prior prompt response confirms cancellation and drained updates.
                # A missing response never causes a second prompt to be sent.
                request_id = await start(text)
                continue
            params = value.get("params") or {}
            if (
                awaiting
                and value.get("method") == "session/update"
                and params.get("sessionId") == session_id
                and params.get("update", {}).get("sessionUpdate")
                in {
                    "agent_message_chunk",
                    "agent_thought_chunk",
                    "tool_call",
                }
            ):
                instructions.acknowledge(awaiting, "accepted")
                awaiting = None
            await event(value)
        raise CliError("ACP 连接提前结束")
    finally:
        instructions.close()
