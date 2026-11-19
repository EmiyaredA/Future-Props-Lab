"""Explicit standalone startup and spreadsheet-only migration."""

import argparse
import os
from pathlib import Path

import uvicorn
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import load_pem_public_key

from studio.apps.spreadsheet_workshop.storage.migrations.registry import MIGRATIONS
from studio.assembly.independent.runtime_options import (
    add_runtime_options,
    parse_runtime_arguments,
    runtime_for,
)
from studio.assembly.independent.spreadsheet_workshop.application import create_app
from studio.contracts.gateway.routing import RouteCatalog
from studio.runtime.database.migrations import apply
from studio.runtime.lifecycle.locking import service_lock


def main():
    parser = argparse.ArgumentParser(description="FPL Spreadsheet")
    add_runtime_options(parser)
    parser.add_argument("command", choices=("serve", "migrate"))
    parser.add_argument("--state-root", type=Path, default=Path("/state"))
    parser.add_argument("--public-key", type=Path, default=Path("/run/fpl/identity-public.pem"))
    parser.add_argument(
        "--catalog", type=Path, default=Path("/app/deploy/contracts/ownership.json")
    )
    parser.add_argument("--schema", type=Path, default=Path("/app/deploy/contracts/openapi.json"))
    parser.add_argument("--web-root", type=Path, default=Path("/app/web"))
    parser.add_argument("--port", type=int, default=8080)
    options = parse_runtime_arguments(parser)
    runtime_for(options)
    if options.command == "migrate":
        with service_lock(options.state_root):
            apply(options.state_root / "service.db", "spreadsheet", MIGRATIONS)
        return
    key = load_pem_public_key(options.public_key.read_bytes())
    if not isinstance(key, Ed25519PublicKey):
        parser.error("Identity 公钥类型无效")
    uploads = options.state_root / ".http-uploads"
    if uploads.is_symlink():
        parser.error("上传暂存目录不能是符号链接")
    uploads.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.environ["TMPDIR"] = str(uploads.resolve())
    app = create_app(
        state_root=options.state_root,
        public_key=key,
        catalog=RouteCatalog.read(options.catalog),
        schema_path=options.schema,
        web_root=None if (options.web_root / ".api-only").is_file() else options.web_root,
    )
    uvicorn.run(app, host=options.host, port=options.port, proxy_headers=False, access_log=False)


if __name__ == "__main__":
    main()
