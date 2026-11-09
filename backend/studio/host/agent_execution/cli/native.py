"""OpenCode JSON events, DeepSeek Harness ACP and Pi RPC with declared MCP tools."""

import asyncio
import json
import re
from pathlib import Path
from tempfile import TemporaryDirectory

from studio.contracts.agent_runtime.catalog import PI_REASONING_EFFORTS

from .isolation import launch
from .opencode_models import MODEL_ID, read_opencode_models
from .transport import MAX_BYTES, CliError, close_transport, spawn_transport
from .usage import UsageAccumulator, opencode_usage, pi_usage, token_counts


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


async def initialize_acp(protocol, event):
    await protocol.rpc(
        "initialize",
        {
            "protocolVersion": 1,
            "clientCapabilities": {},
            "clientInfo": {"name": "future_props_lab", "version": "1"},
        },
        event,
    )


def acp_option(result, identity):
    options = result.get("configOptions")
    if not isinstance(options, list):
        return {}
    selectors = [
        row
        for row in options
        if isinstance(row, dict)
        and isinstance(row.get("id"), str)
        and row.get("type", "select") == "select"
    ]
    option = next((row for row in selectors if row["id"] == identity), None)
    if option is None and identity == "model":
        option = next((row for row in selectors if row.get("category") == "model"), None)
    return option or {}


def acp_choices(option):
    options = option.get("options")
    if not isinstance(options, list):
        return {}
    choices = {}
    for row in options:
        if not isinstance(row, dict):
            continue
        group = row.get("options")
        for choice in group if isinstance(group, list) else [row]:
            if isinstance(choice, dict) and isinstance(choice.get("value"), str):
                label = choice.get("name")
                value = choice["value"]
                choices.setdefault(
                    value, label[:160] if isinstance(label, str) and label.isprintable() else value
                )
    return choices


async def set_acp_option(protocol, event, session_id, result, key, value, *, confirm=True):
    selector = acp_option(result, key)
    if not selector or (confirm and value not in acp_choices(selector)):
        raise CliError("DeepSeek Harness 已不提供所选模型或推理档位，请重新选择")
    updated = await protocol.rpc(
        "session/set_config_option",
        {"sessionId": session_id, "configId": selector["id"], "value": value},
        event,
    )
    if confirm and acp_option(updated, key).get("currentValue") != value:
        raise CliError("DeepSeek Harness 未确认所选配置，请重新选择")
    return updated


async def acp(protocol, root, model, prompt, config, emit, allowed, *, harness_effort=None):
    session_id = None
    titles = {}
    parts = []

    async def event(value):
        method, params = value.get("method"), value.get("params") or {}
        if method == "session/update" and session_id and params.get("sessionId") == session_id:
            update = params.get("update") or {}
            if update.get("sessionUpdate") == "usage_update":
                if usage := token_counts(update, context_used="used", context_limit="size"):
                    await emit("run_usage", usage)
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

    await initialize_acp(protocol, event)
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
        created = await set_acp_option(
            protocol, event, session_id, created, "model", model, confirm=harness_effort is not None
        )
    if harness_effort is not None:
        configured = await set_acp_option(
            protocol, event, session_id, created, "reasoning_effort", harness_effort
        )
        if acp_option(configured, "model").get("currentValue") != model:
            raise CliError("DeepSeek Harness 未保持所选模型，请重新选择")
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
    usage = UsageAccumulator(emit)

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
            if kind == "message_end":
                message = value.get("message") or {}
                if message.get("role") == "assistant":
                    await usage.add(message.get("id"), pi_usage(message))
                if message.get("stopReason") in {"error", "aborted"}:
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


def pi_model_id(provider, model):
    prefix = f"{provider}/"
    return model if model.startswith(prefix) else f"{prefix}{model}"


async def verify_pi_thinking(protocol, model, effort):
    # Pi reports the effective model and level, which can differ from its startup flags.
    identity = "fpl-thinking-check"
    await protocol.send({"id": identity, "type": "get_state"})
    async with asyncio.timeout(10):
        while value := await protocol.read():
            if value.get("id") != identity:
                continue
            state = value.get("data")
            if value.get("success") is True and isinstance(state, dict):
                selected = state.get("model")
                if isinstance(selected, dict):
                    provider, model_id = selected.get("provider"), selected.get("id")
                    if (
                        isinstance(provider, str)
                        and isinstance(model_id, str)
                        and pi_model_id(provider, model_id) == model
                        and state.get("thinkingLevel") == effort
                    ):
                        return
            break
    raise CliError("Pi 未应用所选模型与推理强度，请重新选择")


async def opencode(protocol, prompt, emit):
    protocol.process.stdin.write(prompt.encode())
    await protocol.process.stdin.drain()
    protocol.process.stdin.close()
    parts, completed = [], False
    usage = UsageAccumulator(emit)
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
            part = value.get("part", {})
            await usage.add(part.get("id"), opencode_usage(part))
            completed = part.get("reason") in {"stop", "end_turn"}
    await protocol.process.wait()
    if protocol.process.returncode or not completed:
        raise CliError("OpenCode 未返回完整的完成事件")
    return "".join(parts)


async def converse(
    kind,
    executable,
    root,
    model,
    prompt,
    tool_config,
    emit,
    *,
    watchdog=(),
    instructions=None,
    reasoning_effort=None,
    model_variant=None,
    harness_effort=None,
):
    if model_variant:
        provider, _, model_name = model.partition("/")
        if kind != "opencode" or not model_name or not MODEL_ID.fullmatch(model):
            raise CliError("OpenCode 模型变体需要明确的模型")
        with TemporaryDirectory(prefix="fpl-opencode-variants-") as directory:
            catalog_root = Path(directory)
            async with launch(kind, executable, catalog_root, {}) as (_, catalog_env):
                models = await read_opencode_models(
                    executable, catalog_env, catalog_root, require_metadata=True, provider=provider
                )
        selected = next((entry for entry in models if entry["id"] == model), None)
        if not selected or model_variant not in {item["id"] for item in selected["variants"]}:
            raise CliError("OpenCode 模型已不提供所选变体，请重新选择")
    async with launch(kind, executable, root, tool_config) as (args, env):
        if model_variant:
            args += ["--variant", model_variant]
        if model and kind != "dsh":
            args += ["--model", model]
        if reasoning_effort:
            if kind != "pi" or not model or reasoning_effort not in PI_REASONING_EFFORTS:
                raise CliError("此 Agent 不支持所选推理强度")
            args += ["--thinking", reasoning_effort]
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
                    harness_effort=harness_effort,
                )
            if kind == "pi":
                if reasoning_effort:
                    await verify_pi_thinking(protocol, model, reasoning_effort)
                return await pi(protocol, prompt, emit, instructions)
            return await opencode(protocol, prompt, emit)
        finally:
            await close_transport(process)
