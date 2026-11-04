"""Installed entry point shared by the project owners."""

import argparse
from pathlib import Path

import uvicorn
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import load_pem_public_key

from .locking import service_lock
from .migrations import apply
from .routing import RouteCatalog


def run_project_owner(service, migrations, create_app):
    parser = argparse.ArgumentParser(description=f"FPL {service} project owner")
    parser.add_argument("command", choices=("serve", "migrate"))
    parser.add_argument("--state-root", type=Path, default=Path("/state"))
    parser.add_argument("--public-key", type=Path, default=Path("/run/fpl/identity-public.pem"))
    parser.add_argument("--identity-token", type=Path, default=Path("/run/fpl/identity-token"))
    parser.add_argument(
        "--catalog", type=Path, default=Path("/app/deploy/contracts/ownership.json")
    )
    parser.add_argument("--port", type=int, default=8080)
    options = parser.parse_args()
    if options.command == "migrate":
        with service_lock(options.state_root):
            apply(options.state_root / "service.db", service, migrations)
        return
    public_key = load_pem_public_key(options.public_key.read_bytes())
    if not isinstance(public_key, Ed25519PublicKey):
        parser.error("Identity 公钥类型无效")
    app = create_app(
        state_root=options.state_root,
        public_key=public_key,
        credential=options.identity_token.read_text().strip(),
        catalog=RouteCatalog.read(options.catalog),
    )
    uvicorn.run(app, host="0.0.0.0", port=options.port, proxy_headers=False, access_log=False)
