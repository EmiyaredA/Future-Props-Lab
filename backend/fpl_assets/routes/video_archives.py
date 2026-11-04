"""Seal and publish Video's exact project snapshot through its own peer channel."""

from fpl_runtime.archive_transport import SnapshotFileDescription
from fpl_runtime.video_snapshot import (
    ARCHIVE_PREFIX,
    VideoArchiveManifest,
    archive_target,
)

from ..video_archives import VideoArchives
from .archive_http import archive_router

router = archive_router(
    prefix=ARCHIVE_PREFIX,
    archive_target=archive_target,
    auth_field="video_archive_auth",
    archive_factory=VideoArchives,
    descriptor_type=SnapshotFileDescription,
    manifest_type=VideoArchiveManifest,
    max_manifest_bytes=2 * 1024 * 1024,
)
