import asyncio
import json
import os
import re
import signal
from pathlib import Path

EXECUTION_TIMEOUT_SECONDS = 900


class CliError(ValueError):
    pass


def environment():
    names = {
        "PATH",
        "HOME",
        "USER",
        "LOGNAME",
        "LANG",
        "LC_ALL",
        "TMPDIR",
        "CODEX_HOME",
        "CLAUDE_CONFIG_DIR",
        "HTTPS_PROXY",
        "HTTP_PROXY",
        "ALL_PROXY",
        "NO_PROXY",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
    }
    return {name: value for name, value in os.environ.items() if name in names}


async def _stop(process):
    if process.returncode is None:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            await asyncio.wait_for(process.wait(), 3)
        except TimeoutError:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            await process.wait()


async def probe(kind: str, executable: str):
    path = Path(executable) if executable else None
    if not path or not path.is_absolute() or not path.is_file() or not os.access(path, os.X_OK):
        return False, "未配置可用的 CLI 可执行文件"
    process = None
    try:
        process = await asyncio.create_subprocess_exec(
            str(path),
            "--version",
            env=environment(),
            start_new_session=True,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        data, _ = await asyncio.wait_for(process.communicate(), 5)
        version = re.search(rb"(\d+)\.(\d+)\.(\d+)", data[:2048])
        minimum = (0, 163, 0) if kind == "codex" else (2, 1, 259)
        if process.returncode or not version or tuple(map(int, version.groups())) < minimum:
            return False, "CLI 版本不支持所需的受限执行与结构化结果"
        args = ["login", "status"] if kind == "codex" else ["auth", "status"]
        process = await asyncio.create_subprocess_exec(
            str(path),
            *args,
            env=environment(),
            start_new_session=True,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(process.wait(), 10)
        return (True, "已连接") if process.returncode == 0 else (False, "CLI 尚未登录或登录已失效")
    except (OSError, TimeoutError):
        return False, "CLI 状态检查失败，请检查安装与登录状态"
    finally:
        if process:
            await _stop(process)


def command(kind, executable, root, schema, tool_command):
    server = {
        "command": tool_command[0],
        "args": tool_command[1:],
        "env": {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONNOUSERSITE": "1",
        },
    }
    if kind == "codex":
        args = [
            executable,
            "exec",
            "--ignore-user-config",
            "--ignore-rules",
            "--ephemeral",
            "--skip-git-repo-check",
            "--json",
            "--color",
            "never",
            "-C",
            str(root),
            "--output-schema",
            str(schema),
            "-o",
            str(root / "result.json"),
        ]
        overrides = {
            "approval_policy": "never",
            "sandbox_mode": "read-only",
            "web_search": "disabled",
            "history.persistence": "none",
            "project_doc_max_bytes": 0,
            "features.shell_tool": False,
            "features.shell_snapshot": False,
            "features.hooks": False,
            "features.apps": False,
            "features.plugins": False,
            "features.multi_agent": False,
            "features.memories": False,
            "features.skill_mcp_dependency_install": False,
            "tools.view_image": False,
        }
        for name, value in overrides.items():
            args += ["-c", f"{name}={json.dumps(value)}"]
        # Inline TOML avoids loading any global MCP server or passing the FPL environment.
        args += [
            "-c",
            "mcp_servers.acceptance_task="
            + "{command="
            + json.dumps(server["command"])
            + ",args="
            + json.dumps(server["args"])
            + ",required=true,enabled_tools="
            + json.dumps(["manifest", "image", "sample"])
            + ",env={PATH="
            + json.dumps(server["env"]["PATH"])
            + ',PYTHONDONTWRITEBYTECODE="1",PYTHONNOUSERSITE="1"}}',
        ]
        return [*args, "-"]
    return [
        executable,
        "--restricted",
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--no-session-persistence",
        "--permission-prompts",
        "none",
        "--tools",
        "",
        "--setting-sources",
        "",
        "--settings",
        '{"disableAllHooks":true}',
        "--strict-mcp-config",
        "--mcp-config",
        json.dumps({"mcpServers": {"acceptance_task": server}}),
        "--allowedTools",
        "mcp__acceptance_task__manifest,mcp__acceptance_task__image,mcp__acceptance_task__sample",
        "--max-turns",
        "30",
        "--json-schema",
        schema.read_text(),
    ]


async def execute(kind, executable, root, schema, tool_command, prompt, cancelled, watchdog=None):
    """Return a validated transport payload; no application/database state is held here."""
    args = command(kind, executable, root, schema, tool_command)
    if watchdog:
        args = [*watchdog, "--run-agent", str(os.getpid()), *args]
    process = await asyncio.create_subprocess_exec(
        *args,
        cwd=root,
        env=environment(),
        start_new_session=True,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
        limit=1_048_576,
    )
    structured = None
    failed = False
    total = 0

    async def consume():
        nonlocal structured, failed, total
        process.stdin.write(prompt.encode())
        await process.stdin.drain()
        process.stdin.close()
        while line := await process.stdout.readline():
            total += len(line)
            if total > 8 * 1024 * 1024:
                raise CliError("Agent 返回超出限制")
            event = json.loads(line)
            if event.get("type") in {"error", "turn.failed"} or event.get("is_error"):
                failed = True
            if kind == "claude-code" and event.get("type") == "result":
                structured = event.get("structured_output")
                failed = failed or event.get("subtype") != "success"
        await process.wait()

    task = asyncio.create_task(consume())
    try:
        async with asyncio.timeout(EXECUTION_TIMEOUT_SECONDS):
            while not task.done():
                if await cancelled():
                    raise CliError("验收已取消或执行授权已失效")
                await asyncio.wait({task}, timeout=1)
            await task
        if failed or process.returncode:
            raise CliError("Agent 执行失败，请检查连接后手动重试")
        if kind == "codex":
            result = root / "result.json"
            if result.is_symlink() or not result.is_file() or result.stat().st_size > 1_048_576:
                raise CliError("Agent 未返回有效结果")
            structured = json.loads(result.read_text())
        if not isinstance(structured, dict):
            raise CliError("Agent 未返回结构化验收报告")
        return structured
    except TimeoutError:
        raise CliError("验收超过十五分钟，请手动重试") from None
    finally:
        task.cancel()
        await _stop(process)
        await asyncio.gather(task, return_exceptions=True)
