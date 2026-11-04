"""Serve the isolated Creative application or explicitly apply its own migrations."""

import argparse
import os
from pathlib import Path

from fpl_runtime.locking import service_lock
from fpl_runtime.migrations import apply

from .migrations.registry import MIGRATIONS


def main():
    parser = argparse.ArgumentParser(description="FPL Creative")
    parser.add_argument("command", choices=("serve", "migrate"))
    parser.add_argument("--state-root", type=Path, default=Path("/state"))
    parser.add_argument("--public-key", type=Path, default=Path("/run/fpl/identity-public.pem"))
    parser.add_argument("--identity-token", type=Path, default=Path("/run/fpl/identity-token"))
    parser.add_argument(
        "--catalog", type=Path, default=Path("/app/deploy/contracts/ownership.json")
    )
    parser.add_argument("--schema", type=Path, default=Path("/app/deploy/contracts/openapi.json"))
    parser.add_argument("--web-root", type=Path, default=Path("/app/web"))
    parser.add_argument("--creative-install-credentials", type=Path, required=False)
    parser.add_argument("--port", type=int, default=8080)
    options = parser.parse_args()
    if options.command == "migrate":
        with service_lock(options.state_root):
            apply(options.state_root / "service.db", "creative", MIGRATIONS)
        return

    import uvicorn
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    from cryptography.hazmat.primitives.serialization import load_pem_public_key

    from fpl_runtime.creative_peer_config import CreativeInstallCredentials
    from fpl_runtime.routing import RouteCatalog

    from .application import create_app

    public = load_pem_public_key(options.public_key.read_bytes())
    if not isinstance(public, Ed25519PublicKey):
        parser.error("Identity 公钥类型无效")
    web_root = options.web_root
    if (web_root / ".api-only").is_file():
        web_root = None
    credentials = options.creative_install_credentials
    app = create_app(
        state_root=options.state_root,
        catalog=RouteCatalog.read(options.catalog),
        public_key=public,
        credential=options.identity_token.read_text().strip(),
        install_credentials=CreativeInstallCredentials.read(credentials) if credentials else None,
        web_root=web_root,
        schema_path=options.schema,
        version=os.environ.get("FPL_SERVICE_VERSION", "development"),
    )
    uvicorn.run(app, host="0.0.0.0", port=options.port, proxy_headers=False, access_log=False)


if __name__ == "__main__":
    main()
