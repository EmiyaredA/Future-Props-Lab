"""Shared configuration format; independent of the application and database runtime."""

from __future__ import annotations

import os
import sys
import tomllib
from pathlib import Path

REPO_ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[2]))
CONFIG_FILE = Path(os.environ.get("FPL_CONFIG_FILE", REPO_ROOT / "backend" / "config.toml"))

# TOML field -> (existing environment/Settings field, native TOML type).
FIELDS = {
    "agent_workbench": {
        "enabled": ("fpl_agent_workbench_enabled", bool),
        "poll_seconds": ("fpl_agent_workbench_poll_seconds", int),
        "files_per_pass": ("fpl_agent_workbench_files_per_pass", int),
    },
    "code_agents": {
        "codex_enabled": ("fpl_code_agents_codex_enabled", bool),
        "codex_executable": ("fpl_code_agents_codex_executable", str),
        "claude_enabled": ("fpl_code_agents_claude_enabled", bool),
        "claude_executable": ("fpl_code_agents_claude_executable", str),
        "opencode_enabled": ("fpl_code_agents_opencode_enabled", bool),
        "opencode_executable": ("fpl_code_agents_opencode_executable", str),
        "dsh_enabled": ("fpl_code_agents_dsh_enabled", bool),
        "dsh_executable": ("fpl_code_agents_dsh_executable", str),
        "pi_enabled": ("fpl_code_agents_pi_enabled", bool),
        "pi_executable": ("fpl_code_agents_pi_executable", str),
    },
    "visual_acceptance": {
        "model_owner_user_id": ("fpl_acceptance_model_owner_user_id", str),
        "model_id": ("fpl_acceptance_model_id", str),
        "codex_executable": ("fpl_acceptance_codex_executable", str),
        "codex_user_ids": ("fpl_acceptance_codex_user_ids", list),
        "claude_executable": ("fpl_acceptance_claude_executable", str),
        "claude_user_ids": ("fpl_acceptance_claude_user_ids", list),
    },
    "interview_codex": {
        "enabled": ("fpl_interview_codex_enabled", bool),
        "executable": ("fpl_interview_codex_executable", str),
        "user_id": ("fpl_interview_codex_user_id", str),
    },
    "website": {
        "port": ("fpl_website_port", int),
        "web_root": ("fpl_website_web_root", str),
        "public_enabled": ("fpl_website_public_enabled", bool),
        "legacy_data_root": ("fpl_website_legacy_data_root", str),
    },
    "storage": {"database_path": ("fpl_database_path", str)},
    "security": {"secrets_key": ("fpl_secrets_key", str)},
    "http": {
        "cors_origins": ("cors_origins", list),
        "auth_cookie_secure": ("fpl_auth_cookie_secure", bool),
    },
    "remote_web": {
        "enabled": ("fpl_remote_web_enabled", bool),
        "origin": ("fpl_remote_web_origin", str),
        "port": ("fpl_remote_web_port", int),
        "web_root": ("fpl_remote_web_root", str),
        "ssh_host": ("fpl_remote_web_ssh_host", str),
        "ssh_user": ("fpl_remote_web_ssh_user", str),
        "ssh_port": ("fpl_remote_web_ssh_port", int),
        "remote_port": ("fpl_remote_web_remote_port", int),
        "identity_id": ("fpl_remote_web_identity_id", str),
        "known_hosts_id": ("fpl_remote_web_known_hosts_id", str),
    },
    "limits": {
        name: (f"fpl_{name}", int)
        for name in (
            "visual_asset_max_bytes",
            "galgame_export_max_bytes",
            "project_snapshot_max_bytes",
            "project_snapshot_max_files",
            "skill_archive_max_bytes",
            "skill_expanded_max_bytes",
            "skill_max_files",
        )
    },
    "integrations": {
        "temp_media_upload_url": ("fpl_temp_media_upload_url", str),
        "mcp_stdio_allowed_commands": ("fpl_mcp_stdio_allowed_commands", list),
    },
}


class ConfigurationError(ValueError):
    """Only controlled, value-free messages may cross a startup/logging boundary."""


def flatten(document: dict) -> dict:
    result = {}
    for section, entries in document.items():
        if section not in FIELDS or not isinstance(entries, dict):
            raise ConfigurationError("config.toml 包含未知分组或分组类型错误")
        for name, value in entries.items():
            if name not in FIELDS[section]:
                raise ConfigurationError("config.toml 包含未知配置项，请对照配置示例")
            field, kind = FIELDS[section][name]
            if type(value) is not kind or (
                kind is list and any(type(item) is not str for item in value)
            ):
                raise ConfigurationError(f"config.toml 的 {section}.{name} 类型错误")
            if kind is list:
                separator = "," if name == "cors_origins" else os.pathsep
                if any(separator in item for item in value):
                    raise ConfigurationError(f"config.toml 的 {section}.{name} 含非法分隔符")
                value = separator.join(value)
            result[field] = value
    return result


def read_config(path: Path | None = CONFIG_FILE) -> dict:
    if path is None or not path.exists():
        return {}
    try:
        with path.open("rb") as stream:
            document = tomllib.load(stream)
    except (OSError, ValueError):
        raise ConfigurationError("无法读取 config.toml，或 TOML 格式错误；请检查配置文件") from None
    return flatten(document)
