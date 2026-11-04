"""Start the owned Tools API or explicitly initialize its SQLite state."""

import argparse
import os
import stat
from pathlib import Path

import uvicorn
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import load_pem_public_key
from pydantic import ValidationError

from fpl_runtime.locking import service_lock
from fpl_runtime.migrations import apply
from fpl_runtime.routing import RouteCatalog
from fpl_runtime.tools_native import ToolsNativeOptions

from .application import create_app
from .migrations.registry import MIGRATIONS


def main():
    parser = argparse.ArgumentParser(description="FPL Tools")
    parser.add_argument("command", choices=("serve", "migrate"))
    parser.add_argument("--state-root", type=Path, default=Path("/state"))
    parser.add_argument("--public-key", type=Path, default=Path("/run/fpl/identity-public.pem"))
    parser.add_argument(
        "--catalog", type=Path, default=Path("/app/deploy/contracts/ownership.json")
    )
    parser.add_argument("--schema", type=Path, default=Path("/app/deploy/contracts/openapi.json"))
    parser.add_argument("--web-root", type=Path, default=Path("/app/web"))
    parser.add_argument("--native-config", type=Path)
    parser.add_argument("--port", type=int, default=8080)
    options = parser.parse_args()
    if options.command == "migrate":
        with service_lock(options.state_root):
            apply(options.state_root / "service.db", "tools", MIGRATIONS)
        return
    key = load_pem_public_key(options.public_key.read_bytes())
    if not isinstance(key, Ed25519PublicKey):
        parser.error("Identity 公钥类型无效")
    native = None
    if options.native_config is not None:
        info = options.native_config.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            parser.error("Tools 原生配置必须为本用户独占的普通文件")
        try:
            native = ToolsNativeOptions.model_validate_json(options.native_config.read_text())
        except ValidationError:
            parser.error("Tools 原生配置无效")
    app = create_app(
        state_root=options.state_root,
        public_key=key,
        catalog=RouteCatalog.read(options.catalog),
        web_root=None if (options.web_root / ".api-only").is_file() else options.web_root,
        schema_path=options.schema,
        native_options=native,
    )
    uvicorn.run(app, host="0.0.0.0", port=options.port, proxy_headers=False, access_log=False)


if __name__ == "__main__":
    main()
