"""Run the Galgame project owner against its dedicated state directory."""

import os
from pathlib import Path
from shutil import which

from studio.apps.galgame_workshop.storage.migrations.registry import MIGRATIONS
from studio.assembly.independent.galgame_workshop.application import create_app
from studio.assembly.independent.project_cli import run_project_owner
from studio.runtime.messaging.timed_peer import load_peer_key


def deployed_application(**settings):
    if any(which(program) is None for program in ("ffmpeg", "ffprobe")):
        raise ValueError("Galgame 标注导入需要 ffmpeg 和 ffprobe")
    uploads = settings["state_root"].resolve() / ".http-uploads"
    if uploads.is_symlink():
        raise ValueError("Galgame 上传暂存目录不能是符号链接")
    uploads.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.environ["TMPDIR"] = str(uploads)
    web = Path("/app/web")
    has_web = (web / "build.json").is_file()
    if not has_web and not (web / ".api-only").is_file():
        raise ValueError("Galgame 缺少已安装的浏览器程序")
    return create_app(
        web_root=web if has_web else None,
        archive_key=load_peer_key(
            Path("/run/fpl/galgame-archive-key"), excluded=(settings["credential"],)
        ),
        schema_path=Path("/app/deploy/contracts/openapi.json") if has_web else None,
        **settings,
    )


def main():
    from studio.assembly.independent.galgame_workshop.maintenance import (
        create_export_app,
        create_import_app,
    )

    run_project_owner(
        "galgame",
        MIGRATIONS,
        deployed_application,
        maintenance=(create_export_app, create_import_app),
    )


if __name__ == "__main__":
    main()
