"""Minimal Assets projection: owned paths and file limits, never provider secrets."""

import os
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType

from studio.config import REPO_ROOT, ConfigurationError, read_config

LIMITS = MappingProxyType(
    {
        "fpl_visual_asset_max_bytes": 200 * 1024 * 1024,
        "fpl_galgame_export_max_bytes": 8 * 1024**3,
        "fpl_project_snapshot_max_bytes": 8 * 1024 * 1024 * 1024,
        "fpl_project_snapshot_max_files": 10000,
    }
)


@dataclass(frozen=True)
class StorageSettings:
    database_path: Path
    fpl_visual_asset_max_bytes: int = LIMITS["fpl_visual_asset_max_bytes"]
    fpl_galgame_export_max_bytes: int = LIMITS["fpl_galgame_export_max_bytes"]
    fpl_project_snapshot_max_bytes: int = LIMITS["fpl_project_snapshot_max_bytes"]
    fpl_project_snapshot_max_files: int = LIMITS["fpl_project_snapshot_max_files"]

    def __post_init__(self):
        if not isinstance(self.database_path, Path) or not self.database_path.is_absolute():
            raise ConfigurationError("Assets 数据库必须使用已解析的绝对路径")
        if any(type(getattr(self, name)) is not int or getattr(self, name) < 1 for name in LIMITS):
            raise ConfigurationError("Assets 文件容量或数量限制无效")

    @property
    def runtime_path(self):
        return self.database_path.parent.resolve()

    @property
    def storage_trash_path(self):
        return self.runtime_path / ".trash"

    def account_path(self, owner_user_id):
        if (
            not owner_user_id
            or owner_user_id in {".", ".."}
            or Path(owner_user_id).name != owner_user_id
        ):
            raise ValueError("invalid account id")
        accounts = self.runtime_path / "accounts"
        result = (accounts / owner_user_id).resolve()
        if not result.is_relative_to(accounts):
            raise ValueError("account directory escaped owned storage")
        return result


def load_settings(path, *, environ=None):
    fields = read_config(path)
    if set(fields) - {"fpl_database_path", *LIMITS}:
        raise ConfigurationError("Assets 配置包含不属于此服务的字段")
    environment = os.environ if environ is None else environ
    location = environment.get("FPL_DATABASE_PATH", fields.get("fpl_database_path", ""))
    if not location:
        raise ConfigurationError("缺少 Assets 数据库路径")
    target = Path(location).expanduser()
    target = target if target.is_absolute() else REPO_ROOT / target
    values = {}
    for name, default in LIMITS.items():
        value = environment.get(name.upper(), fields.get(name, default))
        if type(value) not in {int, str}:
            raise ConfigurationError("Assets 文件容量或数量限制无效")
        try:
            parsed = int(value)
        except (ValueError, TypeError):
            raise ConfigurationError("Assets 文件容量或数量限制无效") from None
        if parsed < 1:
            raise ConfigurationError("Assets 文件容量或数量限制无效")
        values[name] = parsed
    return StorageSettings(target.resolve(), **values)
