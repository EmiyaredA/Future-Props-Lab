"""Stage files in the Visual-only portable snapshot trust domain."""

from studio.apps.asset_library.clients.archive_transfer import SnapshotFileDescription
from studio.apps.asset_library.transport.service.archive_http import archive_router
from studio.apps.asset_library.visual.visual_archives import VisualArchives
from studio.contracts.visual_workshop.visual_snapshot import (
    ARCHIVE_PREFIX,
    MAX_LAYOUT_BYTES,
    VisualArchiveManifest,
    archive_target,
)

router = archive_router(
    prefix=ARCHIVE_PREFIX,
    archive_target=archive_target,
    auth_field="visual_archive_auth",
    archive_factory=VisualArchives,
    descriptor_type=SnapshotFileDescription,
    manifest_type=VisualArchiveManifest,
    max_manifest_bytes=MAX_LAYOUT_BYTES,
)
