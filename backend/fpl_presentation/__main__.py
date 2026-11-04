"""Start the installed Presentation service or explicitly initialize its state."""

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


def main():
    parser = argparse.ArgumentParser(description="FPL Presentation")
    parser.add_argument("command", choices=("serve", "migrate"))
    parser.add_argument("--state-root", type=Path, default=Path("/state"))
    parser.add_argument("--public-key", type=Path, default=Path("/run/fpl/identity-public.pem"))
    parser.add_argument(
        "--catalog", type=Path, default=Path("/app/deploy/contracts/ownership.json")
    )
    parser.add_argument("--schema", type=Path, default=Path("/app/deploy/contracts/openapi.json"))
    parser.add_argument("--web-root", type=Path, default=Path("/app/web"))
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--identity-token", type=Path, default=Path("/run/fpl/identity-token"))
    options = parser.parse_args()
    if options.command == "migrate":
        with service_lock(options.state_root):
            apply(options.state_root / "service.db", "presentation", MIGRATIONS)
        return
    key = load_pem_public_key(options.public_key.read_bytes())
    if not isinstance(key, Ed25519PublicKey):
        parser.error("Identity 公钥类型无效")
    try:
        credential = options.identity_token.read_text().strip()
        if len(credential) < 32:
            raise ValueError
    except (OSError, ValueError):
        parser.error("Presentation Identity 凭据无法读取或无效")
    app = create_app(
        state_root=options.state_root,
        public_key=key,
        credential=credential,
        catalog=RouteCatalog.read(options.catalog),
        schema_path=options.schema,
        web_root=None if (options.web_root / ".api-only").is_file() else options.web_root,
    )
    uvicorn.run(app, host="0.0.0.0", port=options.port, proxy_headers=False, access_log=False)


if __name__ == "__main__":
    main()
