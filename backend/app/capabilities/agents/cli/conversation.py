"""Official CLI transports. This module has no business, identity or database state."""

import asyncio
import json
from pathlib import Path

from .model_connection import connection_overrides, toml_value
from .process import CliError, _stop, environment

MAX_BYTES = 16 * 1024 * 1024


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


async def close_transport(process):
    async def drain():
        if process.stdout:
            while await process.stdout.read(65536):
                pass

    draining = asyncio.create_task(drain())
    if process.stdin:
        process.stdin.close()
    await _stop(process)
    if process.stdin:
        try:
            await process.stdin.wait_closed()
        except (BrokenPipeError, ConnectionResetError):
            pass
    try:
        await asyncio.wait_for(draining, 2)
    except TimeoutError:
        draining.cancel()
        await asyncio.gather(draining, return_exceptions=True)


async def spawn_transport(*args, **kwargs):
    creating = asyncio.create_task(asyncio.create_subprocess_exec(*args, **kwargs))
    try:
        return await asyncio.shield(creating)
    except asyncio.CancelledError:
        process = await creating
        await close_transport(process)
        raise


def codex_command(executable, root, model=""):
    args = [executable, "--ignore-user-config", "--ignore-rules"]
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
        "features.memories": False,
        "features.skill_mcp_dependency_install": False,
        "tools.view_image": False,
        "project_doc_max_bytes": 0,
    }
    overrides, _ = connection_overrides()
    settings = {**overrides, **settings}
    for key, value in settings.items():
        args += ["-c", f"{key}={toml_value(value)}"]
    return [*args, "app-server"], {"cwd": str(root), "model": model or None, "ephemeral": True}


async def codex(executable, root, model, prompt, tools, call_tool, emit, *, watchdog=()):
    args, thread_params = codex_command(executable, root, model)
    process = await spawn_transport(
        *watchdog,
        *args,
        cwd=root,
        env=connection_overrides()[1],
        start_new_session=True,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
        limit=MAX_BYTES,
    )
    sequence = 0
    total = 0

    async def send(value):
        process.stdin.write(json.dumps(value).encode() + b"\n")
        await process.stdin.drain()

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
        nonlocal sequence
        sequence += 1
        request_id = sequence
        await send({"id": request_id, "method": method, "params": params})
        while True:
            item = await receive()
            if item.get("id") == request_id and "method" not in item:
                if "error" in item:
                    raise CliError("Codex 协议请求失败，请检查 CLI 版本与连接")
                return item.get("result", {})
            await event(item)

    async def event(item):
        method, params = item.get("method"), item.get("params", {})
        if method == "item/agentMessage/delta":
            await emit("assistant_delta", {"text": params.get("delta", "")})
        elif method == "item/tool/call" and "id" in item:
            name, arguments = params.get("tool", ""), params.get("arguments", {})
            call_id = str(params.get("callId", item["id"]))
            await emit(
                "tool_call", {"tool_call_id": call_id, "tool_name": name, "arguments": arguments}
            )
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
        elif "id" in item and method:
            # Native command/file/credential approvals never widen the declared tool surface.
            await send(
                {
                    "id": item["id"],
                    "error": {"code": -32601, "message": "FPL only permits declared task tools"},
                }
            )

    try:
        await rpc(
            "initialize",
            {
                "clientInfo": {"name": "future_props_lab", "version": "1"},
                "capabilities": {"experimentalApi": True},
            },
        )
        await send({"method": "initialized"})
        thread_params["dynamicTools"] = [
            {"name": t["name"], "description": t["description"], "inputSchema": t["inputSchema"]}
            for t in tools
        ]
        thread = await rpc("thread/start", thread_params)
        thread_id = thread["thread"]["id"]
        await rpc(
            "turn/start", {"threadId": thread_id, "input": [{"type": "text", "text": prompt}]}
        )
        while True:
            item = await receive()
            if item.get("method") == "turn/completed":
                if item.get("params", {}).get("turn", {}).get("status") != "completed":
                    raise CliError("Codex 任务未完成")
                return
            await event(item)
    finally:
        await close_transport(process)


async def codex_models(executable):
    """Model discovery never creates a thread or submits an inference request."""
    args, _ = codex_command(executable, Path.cwd())
    process = await spawn_transport(
        *args,
        env=connection_overrides()[1],
        start_new_session=True,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
        limit=MAX_BYTES,
    )

    async def request(identity, method, params):
        process.stdin.write(
            json.dumps({"id": identity, "method": method, "params": params}).encode() + b"\n"
        )
        await process.stdin.drain()
        while line := await asyncio.wait_for(process.stdout.readline(), 5):
            item = json.loads(line)
            if item.get("id") == identity:
                return item.get("result", {})
        return {}

    try:
        await request(1, "initialize", {"clientInfo": {"name": "future_props_lab", "version": "1"}})
        process.stdin.write(b'{"method":"initialized"}\n')
        await process.stdin.drain()
        value = await request(2, "model/list", {"limit": 100})
        return [
            {"id": m["model"], "label": m.get("displayName", m["model"])}
            for m in value.get("data", [])
            if isinstance(m.get("model"), str) and not m.get("hidden")
        ]
    finally:
        await close_transport(process)


async def claude(executable, root, model, prompt, tool_config, emit, *, watchdog=()):
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
                if item.get("is_error") or item.get("subtype") != "success":
                    raise CliError("Claude Code 任务失败，请检查登录、配额与 CLI 状态")
                completed = True
        await process.wait()
        if process.returncode or not completed:
            raise CliError("Claude Code 连接提前结束")
    finally:
        await close_transport(process)
