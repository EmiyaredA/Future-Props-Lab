"""Connection definitions and side-effect-free probes shared by all CLI consumers."""

import asyncio
import logging
import os
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Literal

from .codex_profile import AUTH_ARGS, CodexLoginRequired, profile_environment, profile_path
from .conversation import codex_models, probe_codex
from .transport import CliError, _stop, environment

logger = logging.getLogger(__name__)

AgentId = Literal["codex", "claude-code", "opencode", "dsh", "pi"]


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
    "opencode": AgentDefinition("opencode", "OpenCode", "opencode", (1, 19, 4), ("auth", "list")),
    "dsh": AgentDefinition("dsh", "DeepSeek Harness", "dsh", (0, 2, 1), ()),
    "pi": AgentDefinition("pi", "Pi", "pi", (1, 4, 0), ("auth", "check", "--json", "--no-refresh")),
}


def settings_prefix(agent_id):
    return "claude" if agent_id == "claude-code" else agent_id


def connection(settings, agent_id):
    definition = DEFINITIONS[agent_id]
    prefix = settings_prefix(agent_id)
    enabled = getattr(settings, f"fpl_code_agents_{prefix}_enabled", None)
    configured = getattr(settings, f"fpl_code_agents_{prefix}_executable", "")
    legacy = [getattr(settings, f"fpl_acceptance_{prefix}_executable", "")]
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


async def _probe_output(path, args, *, timeout=10, env=None):
    process = await asyncio.create_subprocess_exec(
        path,
        *args,
        env=environment() if env is None else env,
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


async def inspect_executable(agent_id, path, *, codex_profile=None):
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
        if codex_profile is not None:
            code, _ = await _probe_output(
                path, (*AUTH_ARGS, *definition.auth_args), env=profile_environment(codex_profile)
            )
            if code:
                raise CodexLoginRequired("请在本机为 FPL 的 Codex 单独登录")
        elif agent_id == "dsh":
            home = Path(os.environ.get("DSH_HOME") or Path.home() / ".dsh")
            credential = home / ".credentials.yaml"
            code = 0 if credential.is_file() and credential.stat().st_size else 1
        elif agent_id == "pi":
            from .isolation import control_output, launch

            with TemporaryDirectory(prefix="fpl-cli-probe-") as root:
                async with launch(agent_id, path, Path(root), {}) as (_, env):
                    code, _ = await control_output(path, list(definition.auth_args), env)
        else:
            code, output = await _probe_output(path, definition.auth_args)
            if agent_id == "opencode":
                clean = re.sub(rb"\x1b\[[0-?]*[ -/]*[@-~]", b"", output)
                code = code or (0 if re.search(rb"\b[1-9]\d* credentials?\b", clean) else 1)
        if code:
            return {
                **result,
                "status": "not_authenticated",
                "message": "请在终端登录 CLI 后重新检测",
            }
        return {**result, "available": True, "status": "ready", "message": "已连接"}
    except CodexLoginRequired as exc:
        return {**result, "status": "not_authenticated", "message": str(exc)}
    except CliError as exc:
        return {**result, "status": "probe_failed", "message": str(exc)}
    except (OSError, TimeoutError, ValueError):
        return {**result, "status": "probe_failed", "message": "CLI 检测失败，请检查安装与登录状态"}


async def inspect_connection(settings, agent_id, *, discover_models=True, app_server=True):
    definition = DEFINITIONS[agent_id]
    result = dict(
        id=agent_id,
        name=definition.name,
        executable="",
        version="",
        models=[],
        available=False,
        status="disabled",
        message="",
        enabled=True,
    )
    try:
        enabled, path, message = connection(settings, agent_id)
        result.update(executable=path, message=message, enabled=enabled)
        if message or not enabled:
            return result
        if sys.platform != "darwin":
            return {
                **result,
                "status": "unsupported_platform",
                "message": "首期仅支持 macOS 桌面版",
            }
        profile = (
            profile_path(settings.runtime_path) if agent_id == "codex" and app_server else None
        )
        result = await inspect_executable(agent_id, path, codex_profile=profile)
        if profile is not None and result["available"]:
            async with probe_codex(path, profile) as request:
                if discover_models:
                    try:
                        result["models"] = await asyncio.wait_for(codex_models(request), 10)
                    except (CliError, OSError, ValueError, TimeoutError) as exc:
                        logger.warning("Codex model discovery failed (%s)", type(exc).__name__)
        return result
    except Exception as exc:
        logger.warning("CLI detection failed for %s (%s)", agent_id, type(exc).__name__)
        return {
            **result,
            "available": False,
            "status": "probe_failed",
            "message": str(exc)
            if isinstance(exc, CliError)
            else "CLI 检测失败，请检查安装与登录状态",
        }
