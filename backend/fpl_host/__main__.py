"""Mac collector CLI. Configuration comes from a protected projection of config.toml."""

import argparse
import asyncio
import json
import os
import stat
import sys
from pathlib import Path

from fpl_runtime.locking import service_lock

from .collector import Collector
from .transport import NativeTransport


def run():
    parser = argparse.ArgumentParser(description="FPL native read-only Agent collector")
    parser.add_argument("command", choices=("collect",))
    parser.add_argument("--connection", type=Path, required=True)
    parser.add_argument("--state-root", type=Path, required=True)
    options = parser.parse_args()
    if options.connection.is_symlink():
        raise ValueError("原生连接配置不能是符号链接")
    metadata = options.connection.stat()
    if metadata.st_uid != os.getuid() or stat.S_IMODE(metadata.st_mode) & 0o077:
        raise ValueError("原生连接配置必须归当前用户所有且权限不超过 0600")
    values = json.loads(options.connection.read_text())
    if set(values) != {"base_url", "credential"}:
        raise ValueError("原生连接配置字段无效")
    with service_lock(options.state_root):
        client = NativeTransport(**values)
        asyncio.run(Collector(client, options.state_root).run())


if __name__ == "__main__":
    try:
        run()
    except (ValueError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from None
