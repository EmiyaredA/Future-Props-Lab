"""Archive staging in the Motion-only Assets trust domain."""

from studio.apps.asset_library.motion.motion_archives import MotionArchives
from studio.apps.asset_library.transport.service.archive_http import archive_router
from studio.contracts.motion_compositor.motion_snapshot import (
    ARCHIVE_PREFIX,
    MotionArchiveManifest,
    motion_archive_target,
)
from studio.runtime.files.signed_payloads import ModelOutputDescription

router = archive_router(
    prefix=ARCHIVE_PREFIX,
    archive_target=motion_archive_target,
    auth_field="motion_archive_auth",
    archive_factory=MotionArchives,
    descriptor_type=ModelOutputDescription,
    manifest_type=MotionArchiveManifest,
    max_manifest_bytes=128 * 1024,
)
