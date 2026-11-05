"""Start the installed Interview service or explicitly initialize its state."""

import argparse
from pathlib import Path

import uvicorn
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import load_pem_public_key

from studio.apps.interview_assistant.storage.migrations.registry import MIGRATIONS
from studio.assembly.independent.interview_assistant.application import create_app
from studio.contracts.gateway.routing import RouteCatalog
from studio.runtime.database.migrations import apply
from studio.runtime.http.native_ingress import NativeWorkerOptions
from studio.runtime.lifecycle.locking import service_lock


def main():
    parser = argparse.ArgumentParser(description="FPL Interview")
    parser.add_argument("command", choices=("serve", "migrate"))
    parser.add_argument("--state-root", type=Path, default=Path("/state"))
    parser.add_argument("--public-key", type=Path, default=Path("/run/fpl/identity-public.pem"))
    parser.add_argument(
        "--catalog", type=Path, default=Path("/app/deploy/contracts/ownership.json")
    )
    parser.add_argument("--schema", type=Path, default=Path("/app/deploy/contracts/openapi.json"))
    parser.add_argument("--web-root", type=Path, default=Path("/app/web"))
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--native-options", type=Path, default=Path("/run/fpl/native-options.json"))
    options = parser.parse_args()
    if options.command == "migrate":
        with service_lock(options.state_root):
            apply(options.state_root / "service.db", "interview", MIGRATIONS)
        return
    key = load_pem_public_key(options.public_key.read_bytes())
    if not isinstance(key, Ed25519PublicKey):
        parser.error("Identity 公钥类型无效")
    try:
        native = (
            NativeWorkerOptions.model_validate_json(options.native_options.read_bytes())
            if options.native_options.exists()
            else None
        )
    except (OSError, ValueError):
        parser.error("Interview 原生桥接配置无法读取或无效")
    app = create_app(
        state_root=options.state_root,
        public_key=key,
        options=native,
        catalog=RouteCatalog.read(options.catalog),
        schema_path=options.schema,
        web_root=None if (options.web_root / ".api-only").is_file() else options.web_root,
    )
    uvicorn.run(app, host="0.0.0.0", port=options.port, proxy_headers=False, access_log=False)


if __name__ == "__main__":
    main()
