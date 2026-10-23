"""Connection definitions and side-effect-free probes shared by all CLI consumers."""

import asyncio
import os
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

from .process import _stop, environment


@dataclass(frozen=True)
class AgentDefinition:
    id: str
    name: str
    binary: str
    minimum: tuple[int, int, int]
    auth_args: tuple[str, ...]


DEFINITIONS = {
    "codex": AgentDefinition("codex", "Codex", "codex", (0, 163, 0), ("login", "status")),
    "claude-code": AgentDefinition(
        "claude-code", "Claude Code", "claude", (2, 1, 259), ("auth", "status")
    ),
}


def connection(settings, agent_id):
    definition = DEFINITIONS[agent_id]
    prefix = "codex" if agent_id == "codex" else "claude"
    enabled = getattr(settings, f"fpl_code_agents_{prefix}_enabled", None)
    configured = getattr(settings, f"fpl_code_agents_{prefix}_executable", "")
    legacy = [getattr(settings, f"fpl_acceptance_{prefix}_executable")]
    if agent_id == "codex":
        legacy.append(settings.fpl_interview_codex_executable)
    if enabled is False:
        return False, "", "部署尚未启用此 Agent"
    paths = set(filter(None, legacy))
    if not configured and len(paths) > 1:
        return False, "", "旧连接路径冲突，请在 code_agents 分组指定统一路径"
    configured = configured or next(iter(paths), "")
    # A legacy deployment remains usable for its original purposes only.
    enabled = (
        (bool(paths) or (agent_id == "codex" and settings.fpl_interview_codex_enabled))
        if enabled is None
        else enabled
    )
    if not enabled:
        return False, "", "部署尚未启用此 Agent"
    found = configured or shutil.which(definition.binary)
    if not found:
        candidates = [Path.home() / ".local/bin" / definition.binary]
        if agent_id == "codex":
            candidates.append(
                Path(
                    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/"
                    "CodexCLI.app/Contents/MacOS/codex"
                )
            )
        found = next((str(p) for p in candidates if p.is_file()), "")
    return True, str(Path(found).absolute()) if found else "", ""


async def _probe_output(path, args, *, timeout=10):
    process = await asyncio.create_subprocess_exec(
        path,
        *args,
        env=environment(),
        start_new_session=True,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        output = await asyncio.wait_for(process.stdout.read(16384), timeout)
        await asyncio.wait_for(process.wait(), timeout)
        return process.returncode, output
    finally:
        await _stop(process)


async def inspect_executable(agent_id, path):
    definition = DEFINITIONS[agent_id]
    result = dict(
        id=agent_id,
        name=definition.name,
        executable=path,
        version="",
        models=[],
        available=False,
        status="disabled",
        message="",
        enabled=True,
    )
    if (
        not path
        or not Path(path).is_absolute()
        or not Path(path).is_file()
        or not os.access(path, os.X_OK)
    ):
        return {
            **result,
            "status": "not_installed",
            "message": "未找到可执行 CLI，请安装后重新检测",
        }
    try:
        code, output = await _probe_output(path, ["--version"])
        version = re.search(rb"(\d+)\.(\d+)\.(\d+)", output)
        if code or not version or tuple(map(int, version.groups())) < definition.minimum:
            return {**result, "status": "unsupported_version", "message": "CLI 版本不支持受限执行"}
        result["version"] = version[0].decode()
        code, _ = await _probe_output(path, definition.auth_args)
        if code:
            return {
                **result,
                "status": "not_authenticated",
                "message": "请在终端登录 CLI 后重新检测",
            }
        return {**result, "available": True, "status": "ready", "message": "已连接"}
    except (OSError, TimeoutError):
        return {**result, "status": "probe_failed", "message": "CLI 检测失败，请检查安装与登录状态"}


async def inspect_connection(settings, agent_id, *, discover_models=True):
    definition = DEFINITIONS[agent_id]
    enabled, path, message = connection(settings, agent_id)
    result = dict(
        id=agent_id,
        name=definition.name,
        executable=path,
        version="",
        models=[],
        available=False,
        status="disabled",
        message=message,
        enabled=enabled,
    )
    if message or not enabled:
        return result
    if sys.platform != "darwin":
        return {**result, "status": "unsupported_platform", "message": "首期仅支持 macOS 桌面版"}
    result = await inspect_executable(agent_id, path)
    if discover_models and agent_id == "codex" and result["available"]:
        from .conversation import codex_models

        try:
            result["models"] = await asyncio.wait_for(codex_models(path), 10)
        except (ValueError, OSError, TimeoutError, TypeError, KeyError, AttributeError):
            result["models"] = []
    return result
