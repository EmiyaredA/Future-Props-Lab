"""Run Agent Runtime against only its own state and scoped native credentials."""

import argparse
import os
import stat
from pathlib import Path

import uvicorn
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import load_pem_public_key

from studio.apps.agent_runtime.storage.migrations.registry import MIGRATIONS
from studio.assembly.independent.agent_runtime.application import SERVICE, create_app
from studio.contracts.agent_runtime.connections import ConnectionOptions
from studio.contracts.gateway.routing import RouteCatalog
from studio.runtime.database.migrations import apply
from studio.runtime.lifecycle.locking import service_lock


def main():
    parser = argparse.ArgumentParser(description="FPL Agent Runtime")
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
    args = parser.parse_args()
    if args.command == "migrate":
        with service_lock(args.state_root):
            apply(args.state_root / "service.db", SERVICE, MIGRATIONS)
        return
    public_key = load_pem_public_key(args.public_key.read_bytes())
    if not isinstance(public_key, Ed25519PublicKey):
        parser.error("Identity 公钥类型无效")
    options = None
    if args.native_config is not None:
        try:
            info = args.native_config.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
                raise ValueError
            options = ConnectionOptions.model_validate_json(args.native_config.read_text())
        except (OSError, ValueError):
            parser.error("原生配置须为本用户独占且有效的普通文件")
    app = create_app(
        state_root=args.state_root,
        public_key=public_key,
        catalog=RouteCatalog.read(args.catalog),
        options=options,
        schema_path=args.schema,
        web_root=None if (args.web_root / ".api-only").is_file() else args.web_root,
    )
    uvicorn.run(app, host="0.0.0.0", port=args.port, proxy_headers=False, access_log=False)


if __name__ == "__main__":
    main()
