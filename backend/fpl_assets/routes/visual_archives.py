"""Stage files in the Visual-only portable snapshot trust domain."""

from fpl_runtime.archive_transport import SnapshotFileDescription
from fpl_runtime.visual_snapshot import (
    ARCHIVE_PREFIX,
    MAX_LAYOUT_BYTES,
    VisualArchiveManifest,
    archive_target,
)

from ..visual_archives import VisualArchives
from .archive_http import archive_router

router = archive_router(
    prefix=ARCHIVE_PREFIX,
    archive_target=archive_target,
    auth_field="visual_archive_auth",
    archive_factory=VisualArchives,
    descriptor_type=SnapshotFileDescription,
    manifest_type=VisualArchiveManifest,
    max_manifest_bytes=MAX_LAYOUT_BYTES,
)
