"""OpenCode JSON events, DeepSeek Harness ACP and Pi RPC with declared MCP tools."""

import asyncio
import json
import re

from .isolation import launch
from .transport import MAX_BYTES, CliError, close_transport, spawn_transport


class JsonLines:
    def __init__(self, process, *, diagnostics=False):
        self.process, self.diagnostics = process, diagnostics
        self.total, self.sequence = 0, 0

    async def send(self, value):
        self.process.stdin.write(json.dumps(value, ensure_ascii=False).encode() + b"\n")
        await self.process.stdin.drain()

    async def read(self):
        while line := await self.process.stdout.readline():
            self.total += len(line)
            if self.total > MAX_BYTES:
                raise CliError("Agent 输出超过限制")
            if self.diagnostics:
                line = re.sub(rb"\x1b\[[0-?]*[ -/]*[@-~]", b"", line).strip()
                if not line or re.match(rb"^\[[A-Za-z0-9_.:-]+\]\s", line):
                    continue
            try:
                value = json.loads(line)
            except ValueError:
                raise CliError("CLI 返回无效协议事件") from None
            if not isinstance(value, dict):
                raise CliError("CLI 返回无效协议事件")
            return value
        return None

    async def rpc(self, method, params, event):
        self.sequence += 1
        identity = self.sequence
        await self.send({"jsonrpc": "2.0", "id": identity, "method": method, "params": params})
        while value := await self.read():
            if value.get("id") == identity and "method" not in value:
                if "error" in value or not isinstance(value.get("result"), dict):
                    raise CliError("ACP 请求失败，请检查 CLI 登录、模型与版本")
                return value["result"]
            await event(value)
        raise CliError("ACP 连接提前结束")


async def acp(protocol, root, model, prompt, config, emit, allowed):
    session_id = None
    titles = {}
    parts = []

    async def event(value):
        method, params = value.get("method"), value.get("params") or {}
        if method == "session/update" and params.get("sessionId") == session_id:
            update = params.get("update") or {}
            if update.get("sessionUpdate") == "tool_call":
                titles[update.get("toolCallId")] = update.get("title")
            if update.get("sessionUpdate") == "agent_message_chunk":
                content = update.get("content") or {}
                if content.get("type") == "text" and isinstance(content.get("text"), str):
                    parts.append(content["text"])
                    await emit("assistant_delta", {"text": content["text"]})
        elif method and "id" in value:
            response = {"jsonrpc": "2.0", "id": value["id"]}
            if method == "session/request_permission":
                call = params.get("toolCall") or {}
                name = titles.get(call.get("toolCallId"))
                option = next(
                    (x for x in params.get("options", []) if x.get("kind") == "allow_once"), None
                )
                outcome = (
                    {"outcome": "selected", "optionId": option["optionId"]}
                    if name in allowed and option
                    else {"outcome": "cancelled"}
                )
                response["result"] = {"outcome": outcome}
            else:
                response["error"] = {
                    "code": -32601,
                    "message": "FPL only permits declared task tools",
                }
            await protocol.send(response)

    await protocol.rpc(
        "initialize",
        {
            "protocolVersion": 1,
            "clientCapabilities": {},
            "clientInfo": {"name": "future_props_lab", "version": "1"},
        },
        event,
    )
    servers = [
        {
            "name": name,
            "command": server["command"],
            "args": server.get("args", []),
            "env": [{"name": key, "value": value} for key, value in server.get("env", {}).items()],
        }
        for name, server in config.get("mcpServers", {}).items()
    ]
    created = await protocol.rpc("session/new", {"cwd": str(root), "mcpServers": servers}, event)
    session_id = created.get("sessionId")
    if not isinstance(session_id, str) or not session_id:
        raise CliError("ACP 未返回会话 ID")
    if model:
        choices = created.get("configOptions", [])
        selector = next(
            (x for x in choices if x.get("category") == "model" or x.get("id") == "model"), None
        )
        if not selector:
            raise CliError("此 CLI 未提供模型选择，清空覆盖后使用默认模型")
        await protocol.rpc(
            "session/set_config_option",
            {"sessionId": session_id, "configId": selector["id"], "value": model},
            event,
        )
    result = await protocol.rpc(
        "session/prompt",
        {"sessionId": session_id, "prompt": [{"type": "text", "text": prompt}]},
        event,
    )
    if result.get("stopReason") != "end_turn":
        raise CliError("DeepSeek Harness 未正常完成本轮任务")
    await protocol.rpc("session/close", {"sessionId": session_id}, event)
    return "".join(parts)


async def pi(protocol, prompt, emit, instructions=None):
    await protocol.send({"id": "fpl-prompt", "type": "prompt", "message": prompt})
    parts = []

    async def steer(identity, message):
        await protocol.send({"id": identity, "type": "steer", "message": message})

    try:
        while value := await protocol.read():
            kind = value.get("type")
            if kind == "response":
                identity = value.get("id")
                disposition = value.get("data", {}).get("disposition")
                if identity == "fpl-prompt" or value.get("command") == "prompt":
                    if value.get("success") is False or disposition == "handled":
                        raise CliError("Pi 未启动任务，请检查登录和模型连接")
                    if instructions and value.get("success") and disposition == "started":
                        instructions.send = steer
                elif instructions and identity:
                    instructions.acknowledge(
                        identity,
                        "accepted"
                        if value.get("success") and disposition == "queued"
                        else "rejected",
                    )
            if kind == "message_update":
                delta = value.get("assistantMessageEvent") or {}
                if delta.get("type") == "text_delta" and isinstance(delta.get("delta"), str):
                    parts.append(delta["delta"])
                    await emit("assistant_delta", {"text": delta["delta"]})
            if kind == "message_end" and value.get("message", {}).get("stopReason") in {
                "error",
                "aborted",
            }:
                raise CliError("Pi 任务失败，请检查登录和模型连接")
            if kind == "agent_end" and instructions:
                instructions.close()
            if kind == "agent_settled":
                if value.get("aborted"):
                    raise CliError("Pi 任务已中断")
                return "".join(parts)
        raise CliError("Pi 连接提前结束")
    finally:
        if instructions:
            instructions.close()


async def opencode(protocol, prompt, emit):
    protocol.process.stdin.write(prompt.encode())
    await protocol.process.stdin.drain()
    protocol.process.stdin.close()
    parts, completed = [], False
    while value := await protocol.read():
        kind = value.get("type")
        if kind == "error":
            raise CliError("OpenCode 任务失败，请检查登录和模型连接")
        if kind == "text":
            text = value.get("part", {}).get("text", "")
            if isinstance(text, str):
                parts.append(text)
                await emit("assistant_delta", {"text": text})
        if kind == "step_finish":
            completed = value.get("part", {}).get("reason") in {"stop", "end_turn"}
    await protocol.process.wait()
    if protocol.process.returncode or not completed:
        raise CliError("OpenCode 未返回完整的完成事件")
    return "".join(parts)


async def converse(
    kind, executable, root, model, prompt, tool_config, emit, *, watchdog=(), instructions=None
):
    async with launch(kind, executable, root, tool_config) as (args, env):
        if model and kind != "dsh":
            args += ["--model", model]
        process = await spawn_transport(
            *watchdog,
            *args,
            cwd=root,
            env=env,
            start_new_session=True,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            limit=MAX_BYTES,
        )
        protocol = JsonLines(process, diagnostics=kind == "dsh")
        try:
            if kind == "dsh":
                return await acp(
                    protocol,
                    root,
                    model,
                    prompt,
                    tool_config,
                    emit,
                    set(json.loads(env["FPL_CLI_ALLOWED_TOOLS"])),
                )
            if kind == "pi":
                return await pi(protocol, prompt, emit, instructions)
            return await opencode(protocol, prompt, emit)
        finally:
            await close_transport(process)
