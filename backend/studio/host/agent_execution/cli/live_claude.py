"""Keep Claude's isolated JSON input open for interrupt-and-continue messages."""

import json
from uuid import uuid4

from .transport import MAX_BYTES, CliError
from .usage import UsageAccumulator, claude_usage


async def live_claude(process, prompt, emit, instructions):
    replacement = None
    awaiting = {}
    streamed = False
    total = 0
    result_number = 0
    usage = UsageAccumulator(emit)

    async def send(value):
        process.stdin.write(json.dumps(value, ensure_ascii=False).encode() + b"\n")
        await process.stdin.drain()

    async def message(text, identity=None):
        native_id = str(uuid4())
        if identity:
            awaiting[native_id] = identity
        await send(
            {
                "type": "user",
                "uuid": native_id,
                "message": {"role": "user", "content": text},
                "parent_tool_use_id": None,
            }
        )

    async def steer(identity, text):
        nonlocal replacement
        if replacement:
            instructions.acknowledge(identity, "rejected")
            return
        replacement = identity, text
        await send(
            {
                "type": "control_request",
                "request_id": f"interrupt:{identity}",
                "request": {"subtype": "interrupt"},
            }
        )

    await message(prompt)
    try:
        while line := await process.stdout.readline():
            total += len(line)
            if total > MAX_BYTES:
                raise CliError("Agent 输出超过限制")
            item = json.loads(line)
            kind = item.get("type")
            if kind == "system" and item.get("subtype") == "init":
                instructions.send = steer
            if kind == "control_response":
                response = item.get("response") or {}
                if replacement and response.get("request_id") == f"interrupt:{replacement[0]}":
                    if response.get("subtype") == "error":
                        instructions.acknowledge(replacement[0], "rejected")
                        replacement = None
            if kind == "user":
                identity = awaiting.pop(item.get("uuid"), None)
                if identity:
                    instructions.acknowledge(identity, "accepted")
            elif kind == "stream_event":
                delta = item.get("event", {}).get("delta", {})
                if delta.get("type") == "text_delta":
                    streamed = True
                    await emit("assistant_delta", {"text": delta.get("text", "")})
            elif kind == "assistant":
                for part in item.get("message", {}).get("content", []):
                    if part.get("type") == "text" and not streamed:
                        await emit("assistant_delta", {"text": part.get("text", "")})
                streamed = False
            elif kind == "result":
                result_number += 1
                await usage.add(str(result_number), claude_usage(item))
                for native_id in item.get("user_message_uuids", []):
                    if identity := awaiting.pop(native_id, None):
                        instructions.acknowledge(identity, "accepted")
                if replacement:
                    if item.get("subtype") not in {"success", "error_during_execution"}:
                        raise CliError("Claude 未确认中断，补充消息未自动续接")
                    identity, text = replacement
                    replacement = None
                    await message(text, identity)
                    continue
                if item.get("is_error") or item.get("subtype") != "success":
                    raise CliError("Claude Code 任务失败，请检查登录、配额与 CLI 状态")
                # A successful response also confirms input if replay was omitted.
                for identity in awaiting.values():
                    instructions.acknowledge(identity, "accepted")
                awaiting.clear()
                return
        raise CliError("Claude Code 连接提前结束")
    finally:
        instructions.close()
