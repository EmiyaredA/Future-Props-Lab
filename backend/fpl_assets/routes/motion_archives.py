"""Archive staging in the Motion-only Assets trust domain."""

from fpl_runtime.model_outputs import ModelOutputDescription
from fpl_runtime.motion_snapshot import ARCHIVE_PREFIX, MotionArchiveManifest, motion_archive_target

from ..motion_archives import MotionArchives
from .archive_http import archive_router

router = archive_router(
    prefix=ARCHIVE_PREFIX,
    archive_target=motion_archive_target,
    auth_field="motion_archive_auth",
    archive_factory=MotionArchives,
    descriptor_type=ModelOutputDescription,
    manifest_type=MotionArchiveManifest,
    max_manifest_bytes=128 * 1024,
)
