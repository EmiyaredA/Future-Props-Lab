"""Bound a Video project snapshot to its exact source file versions."""

import re

from pydantic import Field

from studio.contracts.asset_library.descriptions import ID
from studio.contracts.motion_compositor.motion_preview import DIGEST
from studio.contracts.motion_compositor.motion_snapshot import MotionArchiveManifest
from studio.contracts.thought_workshop.thought_archives import ArchiveFileKey
from studio.contracts.video_editor.video_assets import PREFIX, SOURCE

PURPOSE = "video.snapshot.read"


def snapshot_target(method, path):
    return method == "POST" and re.fullmatch(rf"{PREFIX}/({ID})/snapshot/({DIGEST})", path)


def snapshot_grant(grant):
    if (grant.caller, grant.purpose, grant.target_service, grant.source_method) != (
        "video",
        PURPOSE,
        "assets",
        "GET",
    ):
        return False
    target = snapshot_target(grant.target_method, grant.target_path)
    return bool(target and grant.source_path == f"{SOURCE}/projects/{target[1]}/snapshot")


IMPORT = SOURCE + "/projects/snapshot-imports"
ARCHIVE_PREFIX = "/_internal/v1/video-archives"
ARCHIVE_PURPOSE = "video.archive.stage"
ARCHIVE_DOMAIN = b"fpl-video-archive-v1"


class VideoArchiveManifest(MotionArchiveManifest):
    files: list[ArchiveFileKey] = Field(max_length=9998)


def archive_target(method, path):
    return method == "POST" and re.fullmatch(
        ARCHIVE_PREFIX + rf"/([a-f0-9]{{32}})/({DIGEST})/(files/[0-9]{{1,4}}|seal)/({DIGEST})",
        path,
    )


def archive_grant(grant):
    return bool(
        grant.caller == "video"
        and grant.purpose == ARCHIVE_PURPOSE
        and (grant.source_method, grant.source_path) == ("POST", IMPORT)
        and grant.target_service == "assets"
        and archive_target(grant.target_method, grant.target_path)
    )
