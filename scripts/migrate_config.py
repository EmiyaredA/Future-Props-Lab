"""Convert private configuration without importing or opening the database."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.runtime.config import Settings  # noqa: E402
from studio.config import CONFIG_FILE, ConfigurationError  # noqa: E402
from studio.config.migration import convert_legacy  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="安全转换 .env 为 config.toml；不操作数据库")
    parser.add_argument("--config", type=Path, default=CONFIG_FILE)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    try:
        result = convert_legacy(args.config, Settings.validate_file_values, apply=args.apply)
    except ConfigurationError as exc:
        parser.exit(1, f"{exc}\n")
    except OSError:
        parser.exit(1, "配置文件操作失败；请检查路径、权限和备份，不要删除原配置\n")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
