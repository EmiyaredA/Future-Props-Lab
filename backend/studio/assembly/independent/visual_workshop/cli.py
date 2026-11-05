"""Run the Visual project owner against its dedicated state directory."""

import os
from pathlib import Path

from studio.apps.visual_workshop.storage.migrations.registry import MIGRATIONS
from studio.assembly.independent.project_cli import run_project_owner
from studio.assembly.independent.visual_workshop.application import create_app
from studio.runtime.messaging.timed_peer import load_peer_key


def deployed_application(**settings):
    uploads = settings["state_root"].resolve() / ".http-uploads"
    if uploads.is_symlink():
        raise ValueError("Visual 上传暂存目录不能是符号链接")
    uploads.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.environ["TMPDIR"] = str(uploads)
    web = Path("/app/web")
    has_web = (web / "build.json").is_file()
    if not has_web and not (web / ".api-only").is_file():
        raise ValueError("Visual 缺少已安装的浏览器程序")
    return create_app(
        web_root=web if has_web else None,
        schema_path=Path("/app/deploy/contracts/openapi.json") if has_web else None,
        **settings,
        generation_key=load_peer_key(Path("/run/fpl/visual-generation-key")),
        assistant_settlement_key=load_peer_key(Path("/run/fpl/visual-assistant-settlement-key")),
        archive_key=load_peer_key(Path("/run/fpl/visual-archive-key")),
        video_segment_key=load_peer_key(Path("/run/fpl/video-segment-visual-key")),
        segment_assets_key=load_peer_key(Path("/run/fpl/visual-segment-assets-key")),
    )


def main():
    from studio.assembly.independent.visual_workshop.maintenance import (
        create_export_app,
        create_import_app,
    )

    run_project_owner(
        "visual",
        MIGRATIONS,
        deployed_application,
        maintenance=(create_export_app, create_import_app),
    )


if __name__ == "__main__":
    main()
