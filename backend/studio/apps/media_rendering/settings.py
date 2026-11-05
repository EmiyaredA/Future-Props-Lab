"""Minimal owned paths and bounded input size; no provider or encryption credentials."""

import os
import re
from dataclasses import dataclass
from pathlib import Path

from studio.config import REPO_ROOT, ConfigurationError, read_config


@dataclass(frozen=True)
class RenderingSettings:
    database_path: Path
    max_input_bytes: int = 200 * 1024 * 1024

    def __post_init__(self):
        if not isinstance(self.database_path, Path) or not self.database_path.is_absolute():
            raise ConfigurationError("Rendering 数据库必须使用已解析的绝对路径")
        if type(self.max_input_bytes) is not int or self.max_input_bytes < 1:
            raise ConfigurationError("Rendering 输入限制无效")

    @property
    def runtime_path(self):
        return self.database_path.parent.resolve()

    def account_path(self, owner):
        if not isinstance(owner, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", owner):
            raise ValueError("invalid account id")
        root = self.runtime_path / "accounts"
        path = (root / owner).resolve()
        if not path.is_relative_to(root):
            raise ValueError("account directory escaped owned storage")
        return path


def load_settings(path, *, environ=None):
    fields = read_config(path)
    if set(fields) - {"fpl_database_path", "fpl_visual_asset_max_bytes"}:
        raise ConfigurationError("Rendering 配置包含不属于此服务的字段")
    environment = os.environ if environ is None else environ
    location = environment.get("FPL_DATABASE_PATH", fields.get("fpl_database_path", ""))
    if not location:
        raise ConfigurationError("缺少 Rendering 数据库路径")
    target = Path(location).expanduser()
    target = target if target.is_absolute() else REPO_ROOT / target
    maximum = environment.get(
        "FPL_VISUAL_ASSET_MAX_BYTES", fields.get("fpl_visual_asset_max_bytes", 200 * 1024 * 1024)
    )
    try:
        if type(maximum) not in {int, str} or int(maximum) < 1:
            raise ValueError()
        return RenderingSettings(target.resolve(), int(maximum))
    except (TypeError, ValueError):
        raise ConfigurationError("Rendering 输入限制无效") from None
