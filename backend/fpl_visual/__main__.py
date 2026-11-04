"""Run the Visual project owner against its dedicated state directory."""

from pathlib import Path

from fpl_runtime.project_owner_cli import run_project_owner
from fpl_runtime.timed_peer import load_peer_key

from .application import create_app
from .migrations.registry import MIGRATIONS


def deployed_application(**settings):
    web = Path("/app/web")
    has_web = (web / "build.json").is_file()
    if not has_web and not (web / ".api-only").is_file():
        raise ValueError("Visual 缺少已安装的浏览器程序")
    return create_app(
        web_root=web if has_web else None,
        schema_path=Path("/app/deploy/contracts/openapi.json") if has_web else None,
        **settings,
        video_segment_key=load_peer_key(Path("/run/fpl/video-segment-visual-key")),
        segment_assets_key=load_peer_key(Path("/run/fpl/visual-segment-assets-key")),
    )


def main():
    run_project_owner("visual", MIGRATIONS, deployed_application)


if __name__ == "__main__":
    main()
