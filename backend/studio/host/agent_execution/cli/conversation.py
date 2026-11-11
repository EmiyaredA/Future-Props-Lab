"""Official CLI transports. This module has no business, identity or database state."""

import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path
from tempfile import TemporaryDirectory

from studio.contracts.agent_runtime.catalog import REASONING_EFFORTS, accepts_reasoning_effort

from .codex_profile import AUTH_ARGS, profile_environment
from .model_connection import toml_value
from .transport import MAX_BYTES, CliError, close_transport, environment, spawn_transport
from .usage import claude_usage, codex_usage


def recorded_result(result):
    if isinstance(result, list):
        result = [
            {
                "type": "image",
                "mimeType": item.get("mimeType"),
                "bytes": len(item.get("data", "")) * 3 // 4,
            }
            if isinstance(item, dict) and item.get("type") == "image"
            else item
            for item in result
        ]
    serialized = json.dumps(result, ensure_ascii=False)
    if len(serialized.encode()) > 256 * 1024:
        return {
            "summary": "工具结果已返回执行器；完整内容超过事件展示上限",
            "bytes": len(serialized.encode()),
        }
    return result


def codex_command(executable, root, model=""):
    args = [executable, "app-server", "--listen", "stdio://", *AUTH_ARGS]
    settings = {
        "approval_policy": "never",
        "sandbox_mode": "read-only",
        "web_search": "disabled",
        "history.persistence": "none",
        "features.shell_tool": False,
        "features.shell_snapshot": False,
        "features.hooks": False,
        "features.apps": False,
        "features.plugins": False,
        "features.multi_agent": False,
        "features.multi_agent_v2": False,
        "features.memories": False,
        "features.skill_mcp_dependency_install": False,
        "features.skip_host_skill_discovery": True,
        "features.skill_search": False,
        "features.image_generation": False,
        "features.view_image": False,
        "tools.view_image": False,
        "project_doc_max_bytes": 0,
    }
    for key, value in settings.items():
        args += ["-c", f"{key}={toml_value(value)}"]
    return args, {"cwd": str(root), "model": model or None, "ephemeral": True}


@asynccontextmanager
async def codex_process(executable, profile, model="", *, watchdog=()):
    env = profile_environment(profile)
    with TemporaryDirectory(prefix="fpl-codex-work-") as directory:
        root = Path(directory).resolve()
        args, thread_params = codex_command(executable, root, model)
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
        try:
            yield process, thread_params
        finally:
            await close_transport(process)


async def send_codex(process, value):
    try:
        process.stdin.write(json.dumps(value).encode() + b"\n")
        await process.stdin.drain()
    except (OSError, RuntimeError):
        raise CliError("Codex app-server 提前退出，请检查专用登录和 CLI 版本") from None


def verify_codex_policy(value):
    config = value.get("config", {})
    features = config.get("features", {})
    if (
        config.get("sandbox_mode") != "read-only"
        or config.get("approval_policy") != "never"
        or config.get("web_search") != "disabled"
        or config.get("cli_auth_credentials_store") != "file"
        or config.get("mcp_servers")
        or features.get("skip_host_skill_discovery") is not True
        or any(
            features.get(name) is not False
            for name in ("shell_tool", "hooks", "plugins", "apps", "multi_agent", "skill_search")
        )
    ):
        raise CliError("Codex app-server 未通过 FPL 隔离设置校验")


async def codex(
    executable,
    profile,
    model,
    prompt,
    tools,
    call_tool,
    emit,
    *,
    watchdog=(),
    instructions=None,
    reasoning_effort=None,
    service_tier=None,
    image_input=(),
):
    async with codex_process(executable, profile, model, watchdog=watchdog) as (
        process,
        thread_params,
    ):
        await codex_turn(
            process,
            thread_params,
            prompt,
            tools,
            call_tool,
            emit,
            instructions,
            reasoning_effort=reasoning_effort,
            service_tier=service_tier,
            image_input=image_input,
        )


async def codex_turn(
    process,
    thread_params,
    prompt,
    tools,
    call_tool,
    emit,
    instructions=None,
    *,
    reasoning_effort=None,
    service_tier=None,
    image_input=(),
):
    sequence = 0
    total = 0

    async def send(value):
        await send_codex(process, value)

    async def receive():
        nonlocal total
        line = await process.stdout.readline()
        if not line:
            raise CliError("Codex 连接提前结束")
        total += len(line)
        if total > MAX_BYTES:
            raise CliError("Agent 输出超过限制")
        return json.loads(line)

    async def rpc(method, params):
        nonlocal sequence, completed
        sequence += 1
        request_id = sequence
        await send({"id": request_id, "method": method, "params": params})
        while True:
            item = await receive()
            if item.get("id") == request_id and "method" not in item:
                if "error" in item:
                    raise CliError("Codex 协议请求失败，请检查 CLI 版本与连接")
                return item.get("result", {})
            completed = await event(item) or completed

    async def handle_tool(item, params):
        name, arguments = params.get("tool", ""), params.get("arguments", {})
        call_id = str(params.get("callId", item["id"]))
        try:
            result = await call_tool(name, arguments)
            content = [{"type": "inputText", "text": json.dumps(result, ensure_ascii=False)}]
            if isinstance(result, list):
                content = [
                    {
                        "type": "inputImage",
                        "imageUrl": f"data:{part['mimeType']};base64,{part['data']}",
                    }
                    if part.get("type") == "image"
                    else {"type": "inputText", "text": part.get("text", "")}
                    for part in result
                ]
            response = {
                "contentItems": [
                    {"type": "inputText", "text": json.dumps(result, ensure_ascii=False)}
                ],
                "success": True,
            }
            response["contentItems"] = content
        except Exception as exc:
            result = {"error": str(exc)[:1000]}
            response = {
                "contentItems": [{"type": "inputText", "text": str(exc)[:1000]}],
                "success": False,
            }
        await emit(
            "tool_result",
            {
                "tool_call_id": call_id,
                "name": name,
                "status": "completed" if response["success"] else "failed",
                "result": recorded_result(result),
            },
        )
        await send({"id": item["id"], "result": response})

    async def event(item):
        method, params = item.get("method"), item.get("params", {})
        if method == "item/agentMessage/delta":
            await emit("assistant_delta", {"text": params.get("delta", "")})
        elif (
            method == "thread/tokenUsage/updated"
            and thread_id is not None
            and params.get("threadId", params.get("thread_id")) == thread_id
        ):
            if usage := codex_usage(params):
                await emit("run_usage", usage)
        elif method == "item/completed":
            completed_item = params.get("item", {})
            if completed_item.get("type") == "reasoning":
                summary = completed_item.get("summary")
                if isinstance(summary, list):
                    text = "\n\n".join(part for part in summary if isinstance(part, str))
                    if text.strip():
                        await emit("reasoning_summary", {"text": text[:12000]})
        elif method == "item/tool/call" and "id" in item:
            await emit(
                "tool_call",
                {
                    "tool_call_id": str(params.get("callId", item["id"])),
                    "tool_name": params.get("tool", ""),
                    "arguments": params.get("arguments", {}),
                },
            )
            task = asyncio.create_task(run_tool(item, params))
            tool_tasks.add(task)
            task.add_done_callback(tool_done)
        elif method == "turn/completed":
            if instructions:
                instructions.close()
            return params.get("turn", {}).get("status") or "failed"
        elif not method and instructions and isinstance(item.get("id"), str):
            if "error" in item:
                status = "rejected"
            else:
                status = (
                    "accepted" if item.get("result", {}).get("turnId") == turn_id else "unknown"
                )
            instructions.acknowledge(item["id"], status)
        elif "id" in item and method:
            # Native command/file/credential approvals never widen the declared tool surface.
            await send(
                {
                    "id": item["id"],
                    "error": {"code": -32601, "message": "FPL only permits declared task tools"},
                }
            )

    async def run_tool(item, params):
        async with tool_lock:
            await handle_tool(item, params)

    def tool_done(task):
        tool_tasks.discard(task)
        if not task.cancelled() and task.exception():
            # A failed tool response makes this transport unusable.
            process.stdin.close()

    tool_lock = asyncio.Lock()
    tool_tasks = set()
    turn_id = None
    thread_id = None
    completed = None

    try:
        await initialize_codex(rpc, send)
        if reasoning_effort or service_tier:
            model = next(
                (
                    item
                    for item in await codex_models(rpc, include_fast=bool(service_tier))
                    if item["id"] == thread_params["model"]
                ),
                None,
            )
            if reasoning_effort and (
                not model or reasoning_effort not in model["reasoning_efforts"]
            ):
                raise CliError("当前 Codex 模型不支持所选推理强度，请重新选择")
            if service_tier and (
                service_tier != "fast" or not model or not model["fast_available"]
            ):
                raise CliError("当前 Codex 模型或登录不支持快档，请重新选择")
        thread_params["dynamicTools"] = [
            {"name": t["name"], "description": t["description"], "inputSchema": t["inputSchema"]}
            for t in tools
        ]
        thread = await rpc("thread/start", thread_params)
        thread_id = thread["thread"]["id"]
        turn_params = {
            "threadId": thread_id,
            "input": [{"type": "text", "text": prompt}, *image_input],
        }
        if reasoning_effort:
            turn_params["effort"] = reasoning_effort
        if service_tier:
            turn_params["serviceTier"] = "fast"
        started = await rpc("turn/start", turn_params)
        turn_id = started.get("turn", {}).get("id")

        async def steer(identity, message):
            try:
                await send(
                    {
                        "id": identity,
                        "method": "turn/steer",
                        "params": {
                            "threadId": thread_id,
                            "expectedTurnId": turn_id,
                            "input": [{"type": "text", "text": message}],
                        },
                    }
                )
            except CliError as exc:
                raise OSError from exc

        if instructions and turn_id and completed is None:
            instructions.send = steer
        while completed is None:
            completed = await event(await receive())
        if completed != "completed":
            raise CliError("Codex 任务未完成")
    finally:
        if instructions:
            instructions.close()
        for task in tool_tasks:
            task.cancel()
        await asyncio.gather(*tool_tasks, return_exceptions=True)


async def initialize_codex(rpc, send):
    await rpc(
        "initialize",
        {
            "clientInfo": {"name": "future_props_lab", "version": "1"},
            "capabilities": {"experimentalApi": True},
        },
    )
    await send({"method": "initialized"})
    verify_codex_policy(await rpc("config/read", {"includeLayers": False}))


@asynccontextmanager
async def probe_codex(executable, profile):
    """Validate the same policy as a turn, without starting a thread."""
    async with codex_process(executable, profile) as (process, _):
        sequence = 0

        async def send(value):
            await send_codex(process, value)

        async def request(method, params):
            nonlocal sequence
            sequence += 1
            await send({"id": sequence, "method": method, "params": params})
            while line := await asyncio.wait_for(process.stdout.readline(), 5):
                item = json.loads(line)
                if not isinstance(item, dict):
                    raise CliError("Codex app-server 协议检测失败")
                if item.get("id") == sequence and "method" not in item:
                    if not isinstance(item.get("result"), dict):
                        raise CliError("Codex app-server 协议检测失败")
                    return item["result"]
            raise CliError("Codex app-server 提前退出，请检查专用登录和 CLI 版本")

        async with asyncio.timeout(10):
            await initialize_codex(request, send)
        yield request


async def codex_models(request, *, include_fast=True):
    value = await request("model/list", {"limit": 100})
    if not isinstance(value.get("data"), list):
        raise CliError("Codex app-server 未返回模型列表")
    models = [
        m
        for m in value["data"]
        if isinstance(m, dict) and isinstance(m.get("model"), str) and not m.get("hidden")
    ]
    fast_login = False
    if include_fast and any(codex_fast_model(model) for model in models):
        try:
            async with asyncio.timeout(3):
                account = (await request("account/read", {"refreshToken": False})).get("account")
            fast_login = isinstance(account, dict) and account.get("type") in {
                "chatgpt",
                "chatgptAuthTokens",
            }
        except (CliError, TimeoutError):
            pass
    return [
        {
            "id": model["model"],
            "label": model["displayName"]
            if isinstance(model.get("displayName"), str)
            else model["model"],
            "reasoning_efforts": codex_reasoning_efforts(model),
            "fast_available": fast_login and codex_fast_model(model),
        }
        for model in models
    ]


def codex_fast_model(model):
    # Happier speedEligibility.ts at a2c45c86804b (MIT).
    def tier_id(value):
        return value.strip().lower() if isinstance(value, str) else ""

    tiers = model.get("serviceTiers", model.get("service_tiers"))
    legacy = model.get("additionalSpeedTiers", model.get("additional_speed_tiers"))
    return (
        isinstance(tiers, list)
        and any(
            isinstance(tier, dict) and tier_id(tier.get("id")) in ("priority", "fast")
            for tier in tiers
        )
    ) or (isinstance(legacy, list) and any(tier_id(tier) == "fast" for tier in legacy))


def codex_reasoning_efforts(model):
    # Happier app-server session controls support both spellings of this model metadata.
    options = model.get("supportedReasoningEfforts", model.get("supported_reasoning_efforts"))
    if not isinstance(options, list):
        return []
    efforts = (
        option.get("reasoningEffort", option.get("reasoning_effort"))
        for option in options
        if isinstance(option, dict)
    )
    return list(
        dict.fromkeys(
            effort for effort in efforts if isinstance(effort, str) and effort in REASONING_EFFORTS
        )
    )


async def claude(
    executable, root, model, prompt, tool_config, emit, *, watchdog=(), reasoning_effort=None
):
    args = [
        executable,
        "--restricted",
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--no-session-persistence",
        "--tools",
        "",
        "--setting-sources",
        "",
        "--settings",
        '{"disableAllHooks":true}',
        "--strict-mcp-config",
        "--mcp-config",
        json.dumps(tool_config),
        "--permission-prompts",
        "none",
        "--allowedTools",
        "mcp__fpl__*",
        "--max-turns",
        "40",
    ]
    if model:
        args += ["--model", model]
    if reasoning_effort:
        if not accepts_reasoning_effort("claude-code", model, reasoning_effort):
            raise CliError("当前 Claude Code 模型不支持所选推理强度")
        args += ["--effort", reasoning_effort]
    process = await spawn_transport(
        *watchdog,
        *args,
        cwd=Path(root),
        env=environment(),
        start_new_session=True,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
        limit=MAX_BYTES,
    )
    total, streamed, completed = 0, False, False
    try:
        process.stdin.write(prompt.encode())
        await process.stdin.drain()
        process.stdin.close()
        while line := await process.stdout.readline():
            total += len(line)
            if total > MAX_BYTES:
                raise CliError("Agent 输出超过限制")
            item = json.loads(line)
            if item.get("type") == "stream_event":
                delta = item.get("event", {}).get("delta", {})
                if delta.get("type") == "text_delta":
                    streamed = True
                    await emit("assistant_delta", {"text": delta.get("text", "")})
            elif item.get("type") == "assistant":
                for part in item.get("message", {}).get("content", []):
                    if part.get("type") == "text" and not streamed:
                        await emit("assistant_delta", {"text": part.get("text", "")})
                streamed = False
            elif item.get("type") == "result":
                if usage := claude_usage(item):
                    await emit("run_usage", usage)
                if item.get("is_error") or item.get("subtype") != "success":
                    raise CliError("Claude Code 任务失败，请检查登录、配额与 CLI 状态")
                completed = True
        await process.wait()
        if process.returncode or not completed:
            raise CliError("Claude Code 连接提前结束")
    finally:
        await close_transport(process)
