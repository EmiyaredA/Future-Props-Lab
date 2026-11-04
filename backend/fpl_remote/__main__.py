"""Launch the dedicated Remote process with its read-only transport projection."""

import argparse
from pathlib import Path

import uvicorn
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import load_pem_public_key

from fpl_runtime.locking import service_lock
from fpl_runtime.migrations import apply
from fpl_runtime.routing import RouteCatalog

from .application import create_app
from .migrations.registry import MIGRATIONS
from .settings import RemoteSettings


def main():
    parser = argparse.ArgumentParser(description="FPL Remote")
    parser.add_argument("command", choices=("serve", "migrate"))
    parser.add_argument("--state-root", type=Path, default=Path("/state"))
    parser.add_argument("--config", type=Path, default=Path("/run/fpl/config.toml"))
    parser.add_argument("--public-key", type=Path, default=Path("/run/fpl/identity-public.pem"))
    parser.add_argument("--identity-token", type=Path, default=Path("/run/fpl/identity-token"))
    parser.add_argument(
        "--catalog", type=Path, default=Path("/app/deploy/contracts/ownership.json")
    )
    parser.add_argument("--schema", type=Path, default=Path("/app/deploy/contracts/openapi.json"))
    parser.add_argument("--guacd-host", choices=("guacd", "127.0.0.1"), default="guacd")
    parser.add_argument("--port", type=int, default=8080)
    options = parser.parse_args()
    if options.command == "migrate":
        with service_lock(options.state_root):
            apply(options.state_root / "service.db", "remote", MIGRATIONS)
        return
    public_key = load_pem_public_key(options.public_key.read_bytes())
    if not isinstance(public_key, Ed25519PublicKey):
        parser.error("Identity 公钥类型无效")
    app = create_app(
        state_root=options.state_root,
        settings=RemoteSettings.read(options.config, guacd_host=options.guacd_host),
        public_key=public_key,
        credential=options.identity_token.read_text().strip(),
        catalog=RouteCatalog.read(options.catalog),
        schema_path=options.schema,
    )
    uvicorn.run(app, host="0.0.0.0", port=options.port, proxy_headers=False, access_log=False)


if __name__ == "__main__":
    main()
