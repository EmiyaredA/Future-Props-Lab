"""Run the Visual project owner against its dedicated state directory."""

from pathlib import Path

from fpl_runtime.project_owner_cli import run_project_owner
from fpl_runtime.timed_peer import load_peer_key

from .application import create_app
from .migrations.registry import MIGRATIONS


def deployed_application(**settings):
    return create_app(
        **settings,
        video_segment_key=load_peer_key(Path("/run/fpl/video-segment-visual-key")),
        segment_assets_key=load_peer_key(Path("/run/fpl/visual-segment-assets-key")),
    )


def main():
    run_project_owner("visual", MIGRATIONS, deployed_application)


if __name__ == "__main__":
    main()
