"""Seal and publish Video's exact project snapshot through its own peer channel."""

from studio.apps.asset_library.clients.archive_transfer import SnapshotFileDescription
from studio.apps.asset_library.transport.service.archive_http import archive_router
from studio.apps.asset_library.video.video_archives import VideoArchives
from studio.contracts.video_editor.video_snapshot import (
    ARCHIVE_PREFIX,
    VideoArchiveManifest,
    archive_target,
)

router = archive_router(
    prefix=ARCHIVE_PREFIX,
    archive_target=archive_target,
    auth_field="video_archive_auth",
    archive_factory=VideoArchives,
    descriptor_type=SnapshotFileDescription,
    manifest_type=VideoArchiveManifest,
    max_manifest_bytes=2 * 1024 * 1024,
)
