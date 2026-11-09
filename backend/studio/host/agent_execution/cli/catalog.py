"""Connection definitions and side-effect-free probes shared by all CLI consumers."""

import asyncio
import logging
import os
import re
import shutil
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

from studio.contracts.agent_runtime.definitions import DEFINITIONS as DEFINITIONS
from studio.contracts.agent_runtime.definitions import AgentId as AgentId

from .codex_profile import AUTH_ARGS, CodexLoginRequired, profile_environment, profile_path
from .conversation import codex_models, probe_codex
from .model_catalog import discover_models as read_model_catalog
from .transport import CliError, _stop, environment, read_control_output

logger = logging.getLogger(__name__)


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
        output = await asyncio.wait_for(read_control_output(process.stdout, 16384), timeout)
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
            from .isolation import launch, pi_auth_status

            with TemporaryDirectory(prefix="fpl-cli-probe-") as root:
                async with launch(agent_id, path, Path(root), {}) as (_, env):
                    code = await pi_auth_status(path, definition.auth_args, env)
        elif agent_id == "opencode":
            code, output = await _probe_output(
                path,
                ("--pure", *definition.auth_args),
                env={**environment(), "OPENCODE_DISABLE_MODELS_FETCH": "true"},
            )
            clean = re.sub(rb"\x1b\[[0-?]*[ -/]*[@-~]", b"", output)
            count = re.search(rb"\b(\d+) credentials?\b", clean)
            if code or count is None:
                raise CliError("无法读取 OpenCode 登录状态，请在终端运行 opencode auth list 检查")
            code = int(count[1] == b"0")
        else:
            code, _ = await _probe_output(path, definition.auth_args)
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


async def inspect_connection(
    settings,
    agent_id,
    *,
    discover_models=True,
    app_server=True,
    probe_disabled=False,
    harness_model=None,
):
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
        if not enabled and probe_disabled:
            prefix = settings_prefix(agent_id)
            probe_settings = settings.model_copy(update={f"fpl_code_agents_{prefix}_enabled": True})
            _, path, message = connection(probe_settings, agent_id)
            result.update(executable=path, message=message)
        if message or (not enabled and not probe_disabled):
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
        if not enabled:
            if result["available"]:
                result.update(status="ready_to_enable", message="安装和登录已验证，等待启用连接")
            return {**result, "enabled": False, "available": False}

        async def populate_models(read):
            try:
                async with asyncio.timeout(10):
                    options = await read()
                if harness_model:
                    result.update(harness_options_model=harness_model, harness_efforts=options)
                else:
                    result["models"] = options
                result["model_catalog"] = "preset" if agent_id == "claude-code" else "discovered"
            except (OSError, ValueError, TimeoutError) as exc:
                result["model_catalog"] = "unavailable"
                logger.warning("%s model discovery failed (%s)", agent_id, type(exc).__name__)

        if result["available"] and profile is not None:
            async with probe_codex(path, profile) as request:
                if discover_models:
                    await populate_models(lambda: codex_models(request))
        elif result["available"] and discover_models and agent_id != "codex":
            await populate_models(
                lambda: read_model_catalog(
                    agent_id, path, **({"harness_model": harness_model} if harness_model else {})
                )
            )
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


def execution_signature(kind, executable):
    """Freeze a configured connection without returning its local executable path."""
    import hashlib
    import json

    data = {"kind": kind, "executable": executable}
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()
