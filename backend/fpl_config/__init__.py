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
    "storage": {"database_path": ("fpl_database_path", str)},
    "security": {"secrets_key": ("fpl_secrets_key", str)},
    "http": {
        "cors_origins": ("cors_origins", list),
        "auth_cookie_secure": ("fpl_auth_cookie_secure", bool),
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
