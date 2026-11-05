"""Start Video Editor or explicitly apply its owned schema."""

import argparse
import os
import re
from pathlib import Path

import uvicorn
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import load_pem_public_key

from studio.apps.video_editor.storage.migrations.registry import MIGRATIONS
from studio.assembly.independent.video_editor.application import create_app
from studio.assembly.independent.video_editor.maintenance import (
    create_export_app,
    create_import_app,
)
from studio.contracts.gateway.routing import RouteCatalog
from studio.runtime.database.migrations import apply
from studio.runtime.database.project_history_migration import (
    add_maintenance_options,
    handle_maintenance,
)
from studio.runtime.lifecycle.locking import service_lock
from studio.runtime.messaging.timed_peer import load_peer_key


def main():
    parser = argparse.ArgumentParser(description="FPL Video Editor")
    parser.add_argument(
        "command", choices=("serve", "migrate", "migration-export", "migration-import")
    )
    parser.add_argument("--state-root", type=Path, default=Path("/state"))
    parser.add_argument("--public-key", type=Path, default=Path("/run/fpl/identity-public.pem"))
    parser.add_argument(
        "--catalog", type=Path, default=Path("/app/deploy/contracts/ownership.json")
    )
    parser.add_argument("--schema", type=Path, default=Path("/app/deploy/contracts/openapi.json"))
    parser.add_argument("--identity-token", type=Path, default=Path("/run/fpl/identity-token"))
    parser.add_argument("--web-root", type=Path, default=Path("/app/web"))
    parser.add_argument("--media-key", type=Path, default=Path("/run/fpl/video-media-key"))
    parser.add_argument("--archive-key", type=Path, default=Path("/run/fpl/video-archive-key"))
    parser.add_argument(
        "--segment-visual-key", type=Path, default=Path("/run/fpl/video-segment-visual-key")
    )
    parser.add_argument("--port", type=int, default=8080)
    add_maintenance_options(parser)
    options = parser.parse_args()
    if handle_maintenance(parser, options, create_export_app, create_import_app):
        return
    if options.command == "migrate":
        with service_lock(options.state_root):
            apply(options.state_root / "service.db", "video", MIGRATIONS)
        return
    key = load_pem_public_key(options.public_key.read_bytes())
    if not isinstance(key, Ed25519PublicKey):
        parser.error("Identity 公钥类型无效")
    try:
        if options.identity_token.is_symlink() or options.identity_token.stat().st_mode & 0o077:
            raise ValueError
        credential = options.identity_token.read_text().strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]{32,256}", credential):
            raise ValueError
        media_key = load_peer_key(options.media_key, excluded=(credential,))
        archive_key = load_peer_key(options.archive_key, excluded=(credential, media_key))
        segment_visual_key = load_peer_key(
            options.segment_visual_key, excluded=(credential, media_key, archive_key)
        )
        if media_key is None or archive_key is None:
            raise ValueError
    except (ValueError, OSError):
        parser.error("剪辑服务需要受保护且独立的 Identity、Rendering 和归档凭据")
    uploads = options.state_root.resolve() / ".http-uploads"
    if uploads.is_symlink():
        parser.error("视频剪辑上传暂存目录不能是符号链接")
    uploads.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.environ["TMPDIR"] = str(uploads)
    app = create_app(
        state_root=options.state_root,
        catalog=RouteCatalog.read(options.catalog),
        public_key=key,
        schema_path=options.schema,
        credential=credential,
        media_key=media_key,
        archive_key=archive_key,
        segment_visual_key=segment_visual_key,
        web_root=None if (options.web_root / ".api-only").is_file() else options.web_root,
    )
    uvicorn.run(app, host="0.0.0.0", port=options.port, proxy_headers=False, access_log=False)


if __name__ == "__main__":
    main()
