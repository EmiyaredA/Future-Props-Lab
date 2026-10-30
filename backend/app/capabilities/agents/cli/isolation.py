"""Build disposable CLI profiles from model settings and credentials, never personal tools."""

import asyncio
import json
import os
import re
from contextlib import asynccontextmanager
from pathlib import Path
from tempfile import TemporaryDirectory

import yaml

from .transport import CliError, _stop, environment, spawn_transport

RESOURCES = Path(__file__).parent


def read_json(path):
    if not path.is_file():
        return {}
    if path.stat().st_size > 1024 * 1024:
        raise CliError("CLI 连接配置超出限制")
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise CliError("CLI 连接配置格式无效")
    return value


async def control_output(executable, args, env, *, cwd=None):
    process = await spawn_transport(
        executable,
        *args,
        env=env,
        cwd=cwd,
        start_new_session=True,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        async with asyncio.timeout(10):
            output = await process.stdout.read(1024 * 1024 + 1)
            await process.wait()
        if len(output) > 1024 * 1024:
            raise CliError("CLI 连接配置超出限制")
        return process.returncode, output
    finally:
        await _stop(process)


def link_credentials(source, target):
    if source.is_file():
        target.symlink_to(source.resolve())


def connection_environment(config, env):
    """Forward only environment references explicitly selected by a model connection."""
    if isinstance(config, dict):
        for key, value in config.items():
            if key in {"apiKey", "apiKeyEnv", "api_key_env"} and isinstance(value, str):
                match = re.fullmatch(r"\{env:([A-Za-z_][A-Za-z0-9_]*)\}", value)
                name = match[1] if match else value
                if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name) and name in os.environ:
                    if name.upper().startswith("FPL_"):
                        raise CliError("不能使用 FPL 后端凭据作为 CLI 模型连接密钥")
                    env[name] = os.environ[name]
            else:
                connection_environment(value, env)
    elif isinstance(config, list):
        for value in config:
            connection_environment(value, env)


def dsh_connection_patches(home):
    class ConnectionsLoader(yaml.SafeLoader):
        pass

    ConnectionsLoader.add_constructor("tag:yaml.org,2002:js", lambda _loader, _node: object())
    result = []
    for source in (home / "profiles/acp/cordis.patch.yml", home / "cordis.patch.yml"):
        if not source.is_file():
            continue
        if source.stat().st_size > 1024 * 1024:
            raise CliError("DeepSeek Harness 连接配置超出限制")
        try:
            rows = yaml.load(source.read_text(), Loader=ConnectionsLoader)
        except yaml.YAMLError:
            raise CliError("DeepSeek Harness 连接配置格式无效") from None
        if not isinstance(rows, list):
            raise CliError("DeepSeek Harness 连接配置格式无效")
        for row in rows:
            if (
                not isinstance(row, dict)
                or row.get("id")
                not in {
                    "acp",
                    "agent-default-model",
                    "llm-deepseek",
                    "llm-deepseek-account",
                    "llm-pi-ai",
                }
                or not isinstance(row.get("config"), dict)
            ):
                continue
            config = row["config"]
            if row["id"] in {"acp", "agent-default-model"}:
                config = {key: config[key] for key in ("provider", "model") if key in config}
            try:
                json.dumps(config)
            except (ValueError, TypeError):
                raise CliError("Harness 模型连接须使用静态配置，不能继承动态脚本") from None
            result.append({"id": row["id"], "config": config})
    return result


@asynccontextmanager
async def launch(kind, executable, root, tool_config):
    root = Path(root)
    # Profiles may link CLI-owned credentials. Keep them outside persistent Workspace trees
    # so a killed process cannot leave external symlinks in a future offline backup.
    with TemporaryDirectory(prefix="fpl-cli-") as directory:
        profile = Path(directory)
        env = environment()
        env["NO_COLOR"] = "1"
        if kind == "opencode":
            env.update(
                {
                    "OPENCODE_PURE": "true",
                    "OPENCODE_DISABLE_AUTOUPDATE": "true",
                    "OPENCODE_DISABLE_PROJECT_CONFIG": "true",
                    "OPENCODE_DISABLE_EXTERNAL_SKILLS": "true",
                    "OPENCODE_DISABLE_CLAUDE_CODE": "true",
                    "OPENCODE_DISABLE_LSP_DOWNLOAD": "true",
                    "OPENCODE_DISABLE_MODELS_FETCH": "true",
                }
            )
            code, output = await control_output(executable, ["debug", "config"], env, cwd=profile)
            if code:
                raise CliError("无法读取 OpenCode 模型连接配置")
            original = json.loads(output)
            if not isinstance(original, dict):
                raise CliError("OpenCode 模型连接配置格式无效")
            config = {
                key: original[key]
                for key in (
                    "model",
                    "small_model",
                    "provider",
                    "enabled_providers",
                    "disabled_providers",
                )
                if key in original
            }
            connection_environment(config, env)
            env["XDG_CONFIG_HOME"] = str(profile / "config")
            env["OPENCODE_CONFIG_DIR"] = str(profile / "config" / "opencode")
            env["OPENCODE_DB"] = str(profile / "opencode.db")
            servers = {}
            allowed = {"*": "deny"}
            for name, server in tool_config.get("mcpServers", {}).items():
                servers[name] = {
                    "type": "local",
                    "command": [server["command"], *server.get("args", [])],
                    "environment": server.get("env", {}),
                    "enabled": True,
                }
                allowed[f"{name}_*"] = "allow"
            config.update(
                mcp=servers, permission=allowed, plugin=[], instructions=[], share="disabled"
            )
            env["OPENCODE_CONFIG_CONTENT"] = json.dumps(config)
            env["OPENCODE_PERMISSION"] = json.dumps(allowed)
            args = [executable, "--pure", "run", "--format", "json"]
        elif kind == "pi":
            home = Path(env.get("PI_CODING_AGENT_DIR") or Path.home() / ".pi/agent")
            settings = read_json(home / "settings.json")
            safe = {
                key: settings[key]
                for key in ("defaultProvider", "defaultModel", "defaultThinkingLevel")
                if isinstance(settings.get(key), str)
            }
            safe["retry"] = {"enabled": False}
            (profile / "settings.json").write_text(json.dumps(safe))
            for name in ("auth.json", "models.json"):
                link_credentials(home / name, profile / name)
            connection_environment(read_json(home / "models.json"), env)
            env["PI_CODING_AGENT_DIR"] = str(profile)
            env["FPL_CLI_MCP_CONFIG"] = json.dumps(tool_config)
            args = [
                executable,
                "--mode",
                "rpc",
                "--no-session",
                "--no-tools",
                "--no-mcp",
                "--no-extensions",
                "--no-skills",
                "--no-prompt-templates",
                "--no-context-files",
                "--no-themes",
                "--no-approve",
                "--offline",
                "--system-prompt",
                "Help the user using only the explicitly registered FPL task tools.",
            ]
            if tool_config.get("mcpServers"):
                args += ["--extension", str(RESOURCES / "pi_tools.mjs")]
        elif kind == "dsh":
            home = Path(env.get("DSH_HOME") or Path.home() / ".dsh")
            env["DSH_HOME"] = str(profile)
            env["DSH_PERMISSION_MODE"] = "read-only"
            # Only shipped bundles are booted; no home/profile patch is inherited.
            disabled = [
                "plugin-manager",
                "config-editor",
                "settings",
                "hmr",
                "agent-instructions",
                "skill-filesystem",
                "tool-bash",
                "tool-pwsh",
                "tool-fs",
                "tool-fs-search",
                "tool-working-directory",
                "tool-jobs",
                "tool-skill",
                "tool-subagent",
                "tool-subagent-fork",
                "tool-subagent-control",
                "tool-subagent-list-agents",
                "tool-workflow",
                "tool-todo",
                "tool-goal",
                "tool-web",
                "mcp-resources",
                "session-title-llm",
                "session-telemetry-otel",
                "tool-plugin-manager",
            ]
            patch = dsh_connection_patches(home) + [
                {"id": name, "disabled": True} for name in disabled
            ]
            connection_environment(patch, env)
            patch += [
                {
                    "id": "credentials",
                    "config": {"path": str(home / ".credentials.yaml"), "watch": False},
                },
                {"insert": [{"id": "fpl-task-tools", "name": str(RESOURCES / "dsh_tools.mjs")}]},
            ]
            path = profile / "fpl.patch.yml"
            path.write_text(yaml.safe_dump(patch))
            names = []
            for server_name, server in tool_config.get("mcpServers", {}).items():
                definitions = server.get("env", {}).get("FPL_TOOL_DEFINITIONS")
                tools = (
                    json.loads(definitions)
                    if definitions
                    else [{"name": name} for name in ("manifest", "image", "sample")]
                )
                names += [f"mcp__{server_name}__{tool['name']}" for tool in tools]
            env["FPL_CLI_ALLOWED_TOOLS"] = json.dumps(names)
            args = [executable, "--profile", "acp", "--patch", str(path)]
        else:
            raise CliError("未知的 CLI 连接类型")
        yield args, env
