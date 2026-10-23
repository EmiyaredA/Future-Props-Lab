"""Only explicitly allowed model-provider configuration enters CLI subprocesses."""

import json
import os
import re
import tomllib
from pathlib import Path
from urllib.parse import urlsplit

from .process import CliError, environment


def connection_overrides() -> tuple[dict, dict]:
    """Read only model/connection fields; never inherit hooks, tools, rules or instructions."""
    home = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")
    path = home / "config.toml"
    if path.is_symlink():
        raise CliError("Codex 配置不能是符号链接")
    try:
        config = tomllib.loads(path.read_text()) if path.is_file() else {}
    except (ValueError, OSError):
        raise CliError("Codex 连接配置无法读取") from None
    overrides, env = {}, environment()
    for name in ("model", "model_provider", "model_reasoning_effort"):
        if isinstance(config.get(name), str):
            overrides[name] = config[name]
    provider = config.get("model_provider", "openai")
    definition = config.get("model_providers", {}).get(provider, {})
    if isinstance(definition, dict):
        allowed = {
            name: definition[name]
            for name in (
                "name",
                "base_url",
                "wire_api",
                "env_key",
                "requires_openai_auth",
                "supports_websockets",
            )
            if name in definition and isinstance(definition[name], (str, bool))
        }
        if allowed:
            if allowed.get("base_url"):
                address = urlsplit(allowed["base_url"])
                if (
                    address.scheme not in {"http", "https"}
                    or not address.hostname
                    or address.username
                    or address.password
                    or address.query
                    or address.fragment
                ):
                    raise CliError("Codex 连接地址不能包含凭据、查询参数或片段")
            overrides[f"model_providers.{provider}"] = allowed
        env_key = allowed.get("env_key", "")
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", str(env_key)) and env_key in os.environ:
            if env_key.upper().startswith("FPL_"):
                raise CliError("不能使用 FPL 后端凭据作为 Codex 连接密钥")
            env[env_key] = os.environ[env_key]
    disabled = []
    for skills in (home / "skills", Path.home() / ".agents" / "skills"):
        for pattern in ("*/SKILL.md", ".system/*/SKILL.md"):
            disabled += [
                {"path": str(file.parent), "enabled": False} for file in skills.glob(pattern)
            ]
    overrides["skills.config"] = disabled
    return overrides, env


def toml_value(value):
    if isinstance(value, dict):
        return (
            "{"
            + ",".join(f"{json.dumps(key)}={toml_value(item)}" for key, item in value.items())
            + "}"
        )
    if isinstance(value, list):
        return "[" + ",".join(toml_value(item) for item in value) + "]"
    return json.dumps(value, ensure_ascii=False)
